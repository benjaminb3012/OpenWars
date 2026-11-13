# Territoire : diagnostic et refonte de la propagation

## 1. Le problème

Dans un système naïf (celui qui donne l'impression d'expansion « aléatoire »), la
colonisation parcourt les cases **non réclamées de la carte** et en attribue
quelques-unes au joueur, souvent triées par identifiant de case ou tirées au
hasard. Trois symptômes en découlent :

1. des **enclaves** détachées du territoire (une case à l'autre bout du monde) ;
2. des fronts qui **téléportent** la conquête (on prend une case derrière une
   chaîne de montagnes ou de l'autre côté d'un détroit) ;
3. un rythme d'expansion **non corrélé au territoire** : les petits pays grossissent
   aussi vite que les grands, et la carte se remplit de taches.

À cela s'ajoutent deux erreurs de représentation fréquentes : mélanger **mer et
terre** dans le même parcours, et recalculer le front en O(carte) à chaque tick.

## 2. Modèle de données

Le territoire est un tableau d'ownership, une valeur par case (comme dans
OpenFrontIO) :

```ts
// packages/engine/src/territory/propagation.ts
class TerritoryIndex {
  readonly owner: Uint16Array;          // 0 = inoccupé, sinon id du joueur
  count(playerId): number;              // nombre de cases
  frontierOf(playerId): ReadonlySet<number>;  // cases libres adjacentes
  setOwner(tile, newOwner): void;       // met à jour compteurs + fronts
}
```

`setOwner()` est le **seul** point d'entrée des changements de propriété. Il
maintient de façon incrémentale :

- le compteur de cases par joueur ;
- l'ensemble des cases **non réclamées adjacentes** au territoire (le front).

Coût : O(1) par changement (4 voisins), au lieu d'un balayage de la carte.

## 3. La vague d'expansion (`expandWave`)

Toute conquête — colonisation, attaque, débarquement, sécession — passe par un
BFS dont l'invariant est central :

> **Une case ne peut être prise que si elle est adjacente à une case déjà
> contrôlée par la vague** (ou par le joueur, pour le point de départ).

Propriétés qui en découlent :

- **Continuité garantie** : aucune enclave ne peut apparaître ;
- **Localité** : la conquête part d'un point de clic (recherche en anneau de la
  case possédée la plus proche) ;
- **Déterminisme** : ordre des voisins fixe (droite, gauche, bas, haut), file
  `Int32Array`, aucun `Math.random` ; à état identique, résultat identique ;
- **Zéro allocation** : tampons réutilisés (`WaveScratch`), pas de `Set` par vague ;
- **Budget** : `budget` de troupes/argent et `maxTiles` bornent la vague ; le coût
  par case est une fonction fournie par l'appelant (terrain, forts, défenseur).

Signature simplifiée :

```ts
expandWave({
  index, terrain, origins, budget, maxTiles, scratch,
  canClaim: (tile, owner) => owner === defenderId && terrain[tile] === LAND,
  costPerTile: (tile) => attackCostPerTile * fortDefense(tile),
  onClaim: (tile) => { destroyBuildings(tile); setOwner(tile, playerId); },
});
```

## 4. Colonisation : répartie, pas en un seul coin

La colonisation automatique (aucun clic requis) échantillonne le front :

- débit : `colonizeBaseRate + cases × colonizeRatePerTile`, plafonné ;
- origine : `spreadFrontierSample(frontier, n, offset)` — échantillonnage régulier
  du front, décalé à chaque tick, donc la croissance **tourne autour** du
  territoire au lieu de pousser toujours du même côté ;
- coût : `colonizeCost` par case, plafonné à 60 % de la trésorerie par tick.

Test associé : après 400 ticks, au moins 3 des 4 quadrants autour de la capitale
sont colonisés (`territory.test.ts`).

## 5. Conquête ennemie

`tryAttack(joueur, x, y)` :

1. refuse l'auto-attaque, l'attaque d'un allié, une nation protégée à l'arrivée ;
2. trouve la case possédée la plus proche du clic (rayon 14, sinon refus) ;
3. fixe l'engagement (`maxAttackCommitment` par défaut, surchargeable) ;
4. coût par case = `attackCostPerTile × défenseFort(tile) × pressionDéfenseur` ;
5. chaque case prise détruit le bâtiment présent et transfère l'ownership ;
6. le défenseur perd `attackDefenderLossPerTile` troupes par case, l'attaquant
   paie exactement ce que la vague a dépensé ;
7. relation de guerre enregistrée, événement mondial émis (dédupliqué).

## 6. Terre et mer séparés

- `expandWave` ne traverse que du **terrain terrestre** (`terrain[tile] === LAND`).
- La mer n'est jamais claimable : on ne peut pas « nager » jusqu'à un continent.
- La projection navale est un mécanisme distinct : port → côte cible, avec
  vérification **ligne d'eau libre** (`waterLineClear` échantillonne le segment
  et refuse toute case terrestre intermédiaire), puis débarquement qui crée une
  tête de pont (une case claimée, puis vague locale).

## 7. Sécession (guerre civile)

`selectSecessionTiles()` :

- graine = une des cases les plus éloignées de la capitale (échantillonnée) ;
- BFS qui **s'éloigne** de la capitale (une case plus proche est ignorée) ;
- les cases avec fort sont **exclues et bloquent** la vague : les forts
  protègent réellement les infrastructures ;
- taille bornée par `civilWarMaxTerritoryShare`.

## 8. Performance

| Opération | Coût |
| --- | --- |
| `setOwner` | O(1) |
| Vague d'attaque plafonnée (240 cases) | O(cases × 4) |
| Colonisation par tick | O(front échantillonné) |
| Front par joueur | maintenu incrémentalement |

Mesure : **0,12 ms par tick** (carte 320×200, 8 nations, 600 ticks) — soit 1,2 %
d'un tick à 10 Hz.

## 9. Tests

`packages/engine/test/territory.test.ts`

- aucun propriétaire isolé (chaque case touchée par 4-voisinage) ;
- connectivité complète du territoire après colonisation ;
- jamais d'expansion sur l'eau ;
- déterminisme : deux parties identiques produisent des ownership identiques ;
- attaque lointaine refusée ;
- conquête contiguë d'un bloc ennemi, pertes du défenseur ;
- refus d'attaquer un allié ;
- croissance répartie sur le pourtour.

`map.test.ts` couvre la cohérence des cartes (fraction de terre, absence de
miettes, spawns sur terre et espacés, déterminisme, 3 styles).
