# Architecture

```
packages/shared     types, protocole filaire, tables d'équilibrage (aucune dépendance)
packages/engine     simulation déterministe, aucune I/O
src/server          salle autoritaire (validation + tick + diffusion) + HTTP/WS
src/client          rendu Canvas + interface DOM modulaire
scripts/{build,dev}.mjs, scripts/bench.mjs
```

## Flux d'une action

```
clic joueur
  → ClientMessage { t: "attack", x, y, troops }
  → WebSocket /ws
  → GameServer.onMessage  (parseClientMessage : forme stricte)
  → file d'intentions
  → au début du tick : game.tryAttack(playerId, x, y, troops)
      → validations (nation vivante, cible terrestre, frontière, alliance, protection)
      → expandWave (moteur) : seul endroit où l'ownership change
  → game.advance() : tick complet
  → GameUpdate diffusé à tous les clients
  → client : Store.applyUpdate → HUD/tableau/ticker → rendu Canvas
```

Le client **ne calcule jamais** un résultat de conquête, un coût, une
interception, une sécession ou une production. Il affiche ce que le serveur a
décidé (règle 13 du cahier des charges).

## Moteur (`packages/engine`)

| Module | Rôle |
| --- | --- |
| `game/GameImpl.ts` | état global, actions validées (`try*`), pipeline de tick, updates |
| `game/player.ts` | état de nation, création, couleurs dérivées (rebelles) |
| `map/generate.ts` + `map/noise.ts` | cartes procédurales déterministes (continents, provinces, spawns) |
| `map/grid.ts` | constantes et helpers de grille |
| `territory/propagation.ts` | `TerritoryIndex`, `expandWave`, recherche de frontière, échantillonnage |
| `territory/secession.ts` | sélection déterministe des cases sécessionnistes |
| `politics/governments.ts` | résolution des modificateurs de régime |
| `politics/happiness.ts` | bonheur / mécontentement / déclenchement de sécession |
| `diplomacy` (dans `GameImpl`) | alliances, demandes, cadeaux, transferts automatiques |
| `economy/production.ts` | formules pures (population max, revenus détaillés) |
| `economy/transport.ts` | réseaux routiers (BFS) et règle « usine connectée » |
| `buildings/manager.ts` | placement, niveaux, dégâts, forts, SAM, index spatiaux |
| `military/strategic.ts` | portée/rayon/retombée, probabilité d'interception, MIRV |
| `military/naval.ts` | routes maritimes, côtes, premier pas en eau |
| `events/world-events.ts` | journal d'événements (id monotone, déduplication, sévérité) |
| `ai/bot.ts` | nations IA (utilisent les mêmes points d'entrée validés) |
| `rng.ts` | PRNG mulberry32 + hash (aucun `Math.random`) |

### Pipeline d'un tick (`GameImpl.advance()`)

1. apparition des nations IA après la période d'accueil ;
2. missiles (vol, interception SAM, impact, dégâts, scorch) ;
3. navires (progression, débarquement, bateaux de guerre) ;
4. commerce maritime (création de navires marchands, livraisons) ;
5. aviation (avions commerciaux, chasseurs) ;
6. pour chaque nation vivante : économie → colonisation → politique ;
7. élimination des nations sans territoire ;
8. transferts automatiques d'alliance (toutes les 20 ticks) ;
9. IA ;
10. réseaux de transport (recalcul seulement si modifiés, toutes les 20 ticks) ;
11. décroissance du scorch et des cooldowns ;
12. construction du `GameUpdate`.

L'ordre est fixe : le tick est reproductible.

## Protocole

Client → serveur (`ClientMessage`) : `join`, `spectate`, `attack`, `boat`,
`build`, `upgrade`, `alliance`, `allianceResponse`, `breakAlliance`, `gift`,
`transferSettings`, `government`, `tax`, `missile`, `ping`.

Serveur → client (`ServerMessage`) : `welcome` (snapshot complet),
`update` (delta), `error`, `info`.

- `welcome` contient la carte en base64 (`terrain`, `owner`), les nations, les
  bâtiments, unités, alliances, relations, demandes et les 60 derniers événements.
- `update` contient : état des nations, **deltas de cases** (`tileChanges`),
  bâtiments **seulement si `buildingsVersion` a changé**, unités, alliances,
  relations, événements, notifications, scorch.

Tailles mesurées : snapshot ~120 kB (une fois), update ~6 kB à 10 Hz.

## Serveur (`src/server`)

- `Server.ts` : HTTP statique (`dist/client`), `/healthz`, `/api/config`,
  `/api/state`, WebSocket `/ws`, arrêt propre sur SIGTERM.
- `GameServer.ts` : une salle, file d'intentions appliquées au début du tick,
  limite de 40 messages/s par socket, diffusion groupée, reprise de la simulation
  quand un client revient.
- `validation.ts` : validation de forme stricte de chaque message (aucun `any`,
  aucune confiance dans les valeurs numériques envoyées).

Cas particuliers traités :

| Cas | Comportement |
| --- | --- |
| Déconnexion d'un joueur | sa nation passe sous contrôle IA (elle ne disparaît pas) |
| Aucun client connecté | simulation **en pause** (aucun CPU consommé sur l'hébergement) |
| Plus de place de départ | le joueur humain reprend la nation IA la plus faible |
| Message malformé | erreur ciblée, aucune modification d'état |
| Processus suspendu (free tier) | pas de rattrapage de milliers de ticks |

## Client (`src/client`)

| Fichier | Rôle |
| --- | --- |
| `main.ts` | entrée : réseau, entrées clavier/souris/tactile, boucle de rendu, actions |
| `state.ts` | miroir de l'état serveur (nations, bâtiments, unités, ownership, scorch) |
| `net.ts` | WebSocket + reconnexion exponentielle + rejeu du `join` |
| `render.ts` | deux calques hors écran (terrain, ownership+frontières), unités, libellés |
| `ui/index.ts` | composition (HUD, scores, dock, panneaux, menu contextuel, menu) |
| `ui/hud.ts` | HUD, tableau des scores, bandeau d'événements, notifications, dock |
| `ui/panels.ts` | panneaux construction / politique / diplomatie / armement / aide |
| `ui/contextMenu.ts` | menu contextuel clic droit (attaque marine diplomatie missiles) |
| `ui/menu.ts` | sélection de nation (pseudo, pays, drapeau, couleur, régime) |
| `dom.ts` | helpers DOM (`el`, `button`, `bar`) |

Rendu : le terrain est peint une fois dans un `ImageData` (1 pixel = 1 case) ;
l'ownership est repeint à chaque lot de deltas (64 000 pixels, ~1 ms), frontières
incluses ; le tout est mis à l'échelle avec `imageSmoothingEnabled = false`. Les
vecteurs (unités, bâtiments, libellés) sont dessinés à part.

## Déterminisme

- aucun `Math.random` dans le moteur : PRNG mulberry32 semé par la partie ;
- ordre des itérations toujours trié/fixe (voisins, bâtiments, sites SAM) ;
- arithmétique IEEE 754 uniquement, pas de dépendance à la locale ;
- les tests comparent deux parties identiques (ownership + nations + bâtiments).

## Sécurité / robustesse

- Toutes les entrées réseau passent par `parseClientMessage` (longueurs,
  couleurs hexadécimales, enums, entiers).
- Les actions sont validées par le moteur (argent, troupes, frontière, alliance,
  port, silo, cooldown…).
- Aucun HTML utilisateur injecté dans le DOM (le pseudo/pays sont affichés via
  `textContent`).
