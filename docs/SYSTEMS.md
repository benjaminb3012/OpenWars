# Systèmes de jeu et équilibrage

Toutes les valeurs sont dans `packages/shared/src/config.ts`
(`DEFAULT_BALANCE`), `types/country.ts` (`GOVERNMENTS`),
`types/buildings.ts` (`BUILDINGS`) et `types/strategic.ts`
(`STRATEGIC_WEAPONS`). Le moteur les lit au démarrage : équilibrer ne demande
jamais de toucher la simulation.

## 1. Cadence

| Paramètre | Valeur |
| --- | --- |
| Ticks par seconde | 10 |
| Carte par défaut | 320 × 200 (≈ 22 500 cases de terre) |
| Nations par défaut | 8 (6 IA + joueurs humains) |
| Départ | ~18 cases, 640 $, 500 habitants, 150 troupes |

## 2. Régimes politiques

| Régime | Production | Économie | Impôt de base | Population | Bonheur | Mécontentement | Stabilité |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Démocratie | +5 % | +10 % | 25 % | +25 % | +12 | ×0,75 | +15 % |
| Dictature | +25 % | 0 % | 45 % | −20 % | −18 | ×1,40 | −15 % |
| Monarchie | +5 % | +5 % | 30 % | 0 % | +6 | ×0,90 | +30 % |
| République | +10 % | +20 % | 28 % | +10 % | +8 | ×0,85 | +10 % |
| Communisme | +35 % | −20 % | 50 % | +30 % | −8 | ×1,15 | 0 % |
| Militaire | +20 % | −15 % | 55 % | −15 % | −22 | ×1,25 | −5 % |

Aucun régime ne domine : la production se paie en économie/population, la
stabilité en impôts. Changement de régime : cooldown de 90 s et **+18 points de
mécontentement** (une révolution ne se fait pas gratuitement).

## 3. Bonheur et mécontentement

Le mécontentement monte à chaque tick :

```
pression = baseDiscontent (0,004)
         + pressionRégime     = max(0, -happinessBias) × 0,0008
         + pressionTaille     = min(0,012 ; cases × 0,000004)
         + pressionImpôts     = (taux/100)² × 0,055 × discontentMultiplier
         + pressionGuerre     = 0,025 × discontentMultiplier × nombreDeGuerres
         + pressionPertes     ≈ pertes récentes normalisées
         − soulagementForts   = couvertureForts × 0,06
         − prospérité         = min(0,05 ; revenu/400)
```

Décroissance de 0,006/tick en paix **tant que le mécontentement reste < 92** :
une nation au bord de l'explosion ne se calme pas toute seule.

Le bonheur converge vers `62 + biaisRégime − mécontentement × 0,7`, ce qui
module les revenus (×1,10 / ×1 / ×0,85 / ×0,65) et la régénération militaire.

**Guerre civile** : à 100 % de mécontentement, si le cooldown est écoulé et que
la nation a plus de 14 cases, une sécession se produit (voir
`docs/TERRITORY.md` §7). Sinon le mécontentement est ramené à 78 et un court
répit est accordé.

## 4. Économie

```
revenuNet = base (0,5 $/tick)
          + cases × 0,006 $/tick × éco × fiscalité × bonheur
          + habitants × 0,0003 $/tick × éco × fiscalité × bonheur
          + niveaux d'usines connectées × 1,1 $/tick × production × bonusVilles × bonheur
          + ports × 0,72 $/tick × éco × bonusVilles
          + aéroports × 0,3 $/tick × éco
          − entretien des bâtiments
```

- `fiscalité = 0,5 + taux/100` (taux réglable de 10 % à 90 %) ;
- `bonusVilles = 1 + 0,02 × nombreDeVilles` — cumul linéaire, donc sans
  explosion numérique même avec des centaines de villes ;
- population max = `(420 + cases×9 + niveauxDeVilles×120) × multiplicateurPopulation` ;
- armée max = `population × 0,4`, régénération de 0,09 %/tick du maximum,
  modulée par le moral.

## 5. Bâtiments

| Bâtiment | Coût | Construction | Entretien | Effet principal |
| --- | --- | --- | --- | --- |
| Ville 🏙️ | 520 $ | 6 s | 0,15 $/tick | +120 pop max/niveau, +2 % production/ville |
| Usine 🏭 | 780 $ | 9 s | 0,35 $/tick | +1,1 $/tick/niveau **si connectée** |
| Port ⚓ | 900 $ | 10 s | 0,30 $/tick | commerce maritime, débloque la marine et la capacité commerciale |
| Fort 🛡️ | 620 $ | 8 s | 0,20 $/tick | défense locale (+35 %/niveau) et résistance à la sécession |
| Lance-missiles 🚀 | 1600 $ | 14 s | 0,60 $/tick | débloque missile / MIRV / bombe H |
| Batterie SAM 📡 | 1100 $ | 11 s | 0,40 $/tick | interception automatique |
| Aéroport ✈️ | 1250 $ | 12 s | 0,50 $/tick | avions commerciaux + chasseurs |
| Route 🛣️ | 30 $ | 0,6 s | 0,01 $/tick | relie les bâtiments |

Règles de placement appliquées par le moteur : case **terrestre**, **possédée**,
**libre**, port **sur la côte**. Améliorations : coût ×1,35 par niveau, +25 % de
PV, niveau max de 3 à 5 selon le type.

### Réseau de transport

`computeTransportNetworks()` fait un BFS sur les routes par propriétaire, puis
attache chaque bâtiment adjacent. Une usine (ou un aéroport) ne produit que si
son réseau contient **au moins un autre hub** (ville, port, usine, aéroport).
Recalcul uniquement quand les routes/bâtiments changent, au plus toutes les
20 ticks.

## 6. Militaire

### Attaque terrestre
Coût `2,2` troupes par case, multiplié par la défense des forts et par la
pression du défenseur (`1 + min(1,5 ; troupesDéfenseur/900)`).
Le défenseur perd `1,1` troupe par case prise. Engagement par défaut : 70 % de
l'armée (ou valeur envoyée par le client).

### Marine
- Transports : 120 $, exigent un port, 20 troupes minimum embarquées, route
  maritime vérifiée, tête de pont puis vague de 70 cases max, coût 2,6
  troupes/case.
- Bateaux de guerre : 320 $, coulent les navires marchands et transports ennemis
  dans un rayon de 5 cases, restent 60 s sur zone.

### Aviation
- Avions commerciaux : 34 $ par livraison, +20 %/niveau d'aéroport.
- Chasseurs : frappent les unités navales ennemies à moins de 30 cases.

### Armement stratégique

| Arme | Coût | Rechargement | Rayon | Dégâts troupes | Dégâts civils | Bâtiments | Interception de base | Têtes | Vol |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Missile 🚀 | 900 $ | 22 s | 5 | 180 | 1100 | 90 | 55 % | 1 | 2,6 s |
| MIRV 🎯 | 1500 $ | 32 s | 4 | 130 | 800 | 70 | 45 % | 3 | 3 s |
| Bombe H ☢️ | 3200 $ | 60 s | 11 | 700 | 6500 | 240 | 30 % | 1 | 4 s |

Interception : chaque batterie SAM prête et à portée combine sa probabilité
(`1 − Π(1 − pᵢ)`), avec atténuation par la distance et bonus de niveau ; le
résultat ne peut jamais atteindre 100 %. Les zones frappées laissent des marques
de scorch (600 ticks) qui réduisent l'économie visuelle et la valeur des cases.

## 7. Diplomatie

- **Alliance** : demande → acceptation/refus → membres, puis rupture possible.
- **Transferts** : dons ponctuels (argent/troupes) et pourcentages automatiques
  (0–50 %) appliqués toutes les 20 ticks.
- Un allié ne peut pas être attaqué : le moteur refuse et invite à rompre.
- Seules les nations alliées peuvent échanger des ressources.

## 8. Événements mondiaux

`EventLog` attribue un id monotone, applique une **clé de déduplication** (30
ticks) et classe chaque événement par catégorie (`war`, `civil_war`,
`diplomacy`, `politics`, `economy`, `military`, `building`, `system`) et sévérité
(1 info, 2 notable, 3 majeur). Les événements de sévérité 3 alimentent aussi les
notifications. Le client reçoit les nouveaux événements dans chaque `update` et
**déduplique par id**, ce qui rend le bandeau identique pour tous les joueurs.

## 9. Nations IA

Les bots passent par les mêmes `try*()` que les humains (aucun accès direct à
l'état) : construction (ville/usine/port/fort/SAM/silo/aéroport), routes vers la
ville la plus proche, attaques de la nation la plus faible à portée, frappes
stratégiques quand un silo est disponible, alliances opportunistes. Période
d'accueil de 26 s avant leur apparition pour laisser les humains choisir leur
point de départ.
