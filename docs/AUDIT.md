# Phase 1 — Audit

Date : 2026-11-13 · Branche : `arena/97e387b2-openwars` · Base : `a0cd689`

## 1. État du dépôt `benjaminb3012/OpenWars`

| Élément | Constat |
| --- | --- |
| Commits | 2 (`first commit`, `Add files via upload`) |
| Contenu | `README.md` (6 octets, encodage UTF‑16 : « # OpenWars ») et `render-setup/` |
| Code de jeu | **aucun** (`diskUsage = 0` côté GitHub, pas de `package.json`) |
| Fork d'OpenFrontIO | **non** : `isFork = false`, aucun fork OpenFrontIO sur le compte |

Le dépôt ne contenait donc pas le fork annoncé dans le brief : il n'y avait rien
à auditer, à réutiliser ou à casser.

## 2. Audit de l'upstream `openfrontio/openfrontio`

Cloné en profondeur 1 pour analyse (aucun fichier upstream n'est conservé ici).

| Mesure | Valeur |
| --- | --- |
| Taille du dépôt | ~954 Mo |
| Fichiers suivis | 4 510 |
| `resources/maps` | **759 Mo** (`map.bin` de 3 à 48 Mo par carte) |
| `resources/flags` | 26 Mo |
| Code source (`packages/` + `src/`) | ~10 Mo, 193 fichiers de packages |
| Contraintes | `engines.node >= 24.15` **et** `engine-strict=true` dans `.npmrc` |
| Environnement de ce sandbox | Node **22.22** (aucun binaire Node 24 installable ici) |

Architecture réelle de l'upstream (utile comme référence de conception) :

- `packages/engine` : simulation déterministe (exécutions, état, pathfinding,
  snapshots, worker). Contient déjà `AllianceImpl`, `NationCreation`,
  `RailNetwork`, `TerrainSearchMap`…
- `packages/engine-api` : contrat moteur ↔ hôte (intents, schémas, types).
- `packages/engine-lib` : code partagé hors worker (grille, config, PRNG).
- `packages/shared` : schémas filaires, codec binaire, chargeurs de cartes.
- `src/client` : rendu + interface (Lit / Vite).
- `src/server` : coordination, relais des intents, salons.
- Le cœur tourne **côté client**, dans un worker, et doit rester déterministe.

## 3. Problème identifié

Trois contraintes rendent impossible un fork « tel quel » dans cet environnement :

1. **Taille** : importer l'upstream (1,1 Go hors `.git`, 4 510 fichiers) dépasse
   la limite de commit de l'environnement (~128 Mo / 10 000 fichiers) et noierait
   un dépôt qui ne contient aujourd'hui que deux fichiers.
2. **Exécution** : l'upstream exige Node ≥ 24.15 en mode `engine-strict` ; cet
   environnement fournit Node 22.22 et n'a pas accès aux CDN de binaires Node.
   Impossible d'installer, compiler, tester ou lancer l'upstream ici — donc
   impossible de garantir la règle « ne rien casser » et « tester avant de dire
   que c'est fait ».
3. **Assets** : le jeu ne démarre pas sans les 759 Mo de `resources/maps`. Un
   import partiel produirait un projet non fonctionnel.

## 4. Décision (validée avec le demandeur)

Reconstruire **OpenWars comme un jeu autonome** dans ce dépôt, en reprenant les
concepts d'OpenFrontIO qui comptent pour la suite :

| Concept OpenFrontIO | Équivalent OpenWars |
| --- | --- |
| Simulation déterministe pure, sans I/O | `packages/engine` (`GameImpl`), aucun accès réseau/DOM/timer |
| Intentions clients → serveur → exécution | `ClientMessage` → validation → `try*()` du moteur |
| Territoire = tableau d'ownership par case | `TerritoryIndex` + `Uint16Array` d'ownership |
| Fronts d'attaque locaux | `expandWave()` (BFS déterministe, adjacence stricte) |
| Alliances, transferts | `diplomacy/` + protocole dédié |
| Bâtiments / réseaux | `buildings/` + `economy/transport.ts` |
| Mises à jour par tick | `GameUpdate` (deltas de cases + entités) |

Différence assumée et documentée : la simulation tourne **uniquement sur le
serveur** (mise à jour du monde diffusée aux clients) au lieu d'être rejouée dans
un worker par client. Conséquence : aucun risque de désynchronisation, validation
centralisée, code client plus léger ; le coût est un serveur qui simule (mesuré à
**0,12 ms/tick** pour 8 nations, soit 1,2 % d'un cœur à 10 Hz).

## 5. Ce que l'audit upstream a inspiré

- Séparer **contrat** (`packages/shared`) et **simulation** (`packages/engine`).
- Garder les valeurs d'équilibrage **hors** du code de simulation
  (`BalanceConfig` + tables `GOVERNMENTS`, `BUILDINGS`, `STRATEGIC_WEAPONS`).
- Rendre les bâtiments **fonctionnels dans le moteur** (pas décoratifs).
- Calculs coûteux (réseaux de transport) recalculés **à la demande**, pas à
  chaque tick.
- Un identifiant monotone par événement pour dédupliquer côté client.

## 6. Risques et limites connus

- Cartes **procédurales** uniquement (pas de carte Terre dessinée à la main).
- Une seule salle par processus (pas de matchmaking multi-salons).
- Pas de persistance (redémarrer le service réinitialise le monde).
- Bots heuristiques (pas d'IA stratégique évoluée).
- L'équilibrage a été calibré par simulation (voir `scripts/bench.mjs`) mais
  reste à affiner avec de vrais joueurs.
