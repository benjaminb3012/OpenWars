# État d'avancement vs cahier des charges

Légende : ✅ fait et testé · 🟡 partiel / simplifié · ⬜ non commencé

## Phase 1 — Audit ✅
`docs/AUDIT.md` : état du dépôt, audit de l'upstream OpenFrontIO, contraintes,
décision d'architecture, mesures.

## Phase 2 — Territoire
| Exigence (§3) | État |
| --- | --- |
| Cartes cohérentes, continents, frontières naturelles | ✅ procédural (continents / archipel / pangée), lissage + suppression des miettes |
| Océans, mers, lacs identifiables | ✅ océan / lac séparés par flood fill |
| Répartition équitable des départs | ✅ provinces + échantillonnage du point le plus éloigné |
| Expansion différente selon la position | ✅ côtes, presqu'îles, tailles de provinces |
| Variété des cartes | ✅ graine + style + bruit |
| Propagation locale et progressive | ✅ `expandWave` BFS, adjacence stricte |
| Plus de conquête « aléatoire » | ✅ aucun tirage aléatoire de cases |
| Zones non réclamées colonisables | ✅ colonisation automatique répartie |
| Obstacles géographiques | ✅ la mer bloque ; les forts augmentent le coût |
| Territoires ennemis = vraie conquête | ✅ attaque avec troupes, pertes, défense |
| Connexions maritimes séparées | ✅ débarquements + vérification de route maritime |

## Phase 3 — Identité et politique
| Exigence (§4, §5, §6) | État |
| --- | --- |
| Nom de pays, drapeau, couleur | ✅ écran de sélection |
| Identité visible partout | ✅ HUD, score, carte, diplomatie, événements |
| 6 régimes | ✅ démocratie, dictature, monarchie, république, communisme, militaire |
| Modificateurs production / économie / population | ✅ + stabilité, bonheur, mécontentement |
| Bonheur et mécontentement | ✅ jauges + formules documentées |
| Guerre civile à 100 % | ✅ sécession contiguë, faction hostile, partage troupes/argent |
| Forts = résistance à la sécession | ✅ exclusion + blocage de la vague |

## Phase 4 — Diplomatie
| Exigence (§7, §7.1) | État |
| --- | --- |
| Menu contextuel clic droit | ✅ semi-transparent, borné à l'écran |
| Proposer / accepter / refuser / rompre | ✅ |
| Liste des alliés et accords | ✅ panneau Diplomatie |
| Don de troupes / d'argent | ✅ montants + pourcentages automatiques |
| Validation serveur des transferts | ✅ moteur uniquement |

## Phase 5 — Bâtiments et économie
| Exigence (§8.1–§9) | État |
| --- | --- |
| Villes : pop max + 2 % cumulables | ✅ niveaux, formule linéaire |
| Usines : revenus conditionnés au réseau | ✅ routes + BFS réseau |
| Ports : bateaux marchands, revenus, 7ᵉ capacité | ✅ navires visibles, déblocage `tradeCapacity` |
| Forts : défense + stabilité | ✅ multiplicateur de coût, protection sécession |
| Ressources économiques (argent, entretien, commerce) | ✅ |
| Réseaux identifiés automatiquement | ✅ composantes de routes |

## Phase 6 — Militaire
| Exigence (§7.2, §7.3, §8.5–§8.8) | État |
| --- | --- |
| Débarquement naval avec trajet | ✅ port → côte, ligne d'eau, tête de pont |
| Bateaux de guerre | ✅ interception des navires marchands/transports |
| 3 capacités stratégiques avec coût/cooldown/portée/zone | ✅ missile, MIRV, bombe H |
| Interception | ✅ SAM (probabiliste, cumul des sites) |
| Lance-missiles comme prérequis | ✅ |
| Aéroports + avions commerciaux et chasseurs | ✅ mouvements et revenus réels |
| Améliorations | ✅ niveaux sur tous les bâtiments |

## Phase 7 — Événements et interface
| Exigence (§10, §11) | État |
| --- | --- |
| Bandeau d'événements défilant | ✅ défilement auto, pause au survol |
| Couleurs par catégorie, hiérarchie visuelle | ✅ 8 catégories × 3 sévérités |
| Synchronisation et anti-doublons | ✅ ids monotones + déduplication |
| File d'événements | ✅ ordre garanti par le tick |
| Notifications majeures | ✅ toasts sévérité 3 |
| Menus construction / politique / diplomatie | ✅ |
| Indicateurs économiques et sociaux | ✅ HUD + panneaux |
| Responsive | ✅ media queries ≤ 900 px et ≤ 640 px |

## Phase 8 — Tests et équilibrage
| Exigence | État |
| --- | --- |
| Tests unitaires moteur | ✅ 45 tests (carte, territoire, politique, bâtiments, militaire, déterminisme) |
| Tests client | ✅ 5 tests (HUD, panneaux, menu contextuel, rendu, parcours complet) |
| Test multijoueur | ✅ client WebSocket scripté (join → build → régime → attaque → erreurs serveur) + partie de 60 s avec IA |
| Déterminisme | ✅ deux parties identiques ⇒ états identiques |
| Performance | ✅ 0,12 ms/tick, update ~6 kB |
| Équilibrage | 🟡 calibré par simulation, à affiner avec de vrais joueurs |

## Reste à faire (priorités proposées)

1. **Contenu de carte** : intégrer des cartes géographiques réelles (format
   compact, tuiles compressées) en plus du procédural.
2. **Persistance** : sauvegarde périodique de l'état (SQLite/JSON) pour survivre
   aux redémarrages de l'hébergeur et proposer des statistiques de partie.
3. **Multijoueur à grande échelle** : plusieurs salles, matchmaking, parties
   privées, liste des parties dans le menu.
4. **Diplomatie avancée** : traités de non-agression, pactes de partage,
   coalitions, votes, réputation.
5. **Économie** : impôts par région, entretien des routes, destruction/revente de
   bâtiments, chaînes de production (ressources physiques).
6. **Militaire** : interception des missiles par avions, frontières maritimes
   claims, sous-marins, artillerie côtière, sièges avec attrition par tick.
7. **Interface** : mini-carte, historique des événements (journal filtrable),
   tutoriel interactif, raccourcis clavier pour les panneaux, préférences.
8. **IA** : mémoire des menaces, valeurs de cible, personnalités par régime.
9. **Observabilité** : métriques (ticks/s, latence, taille des paquets), panneau
   admin `/admin` protégé, redémarrage du monde sans redéployer.
10. **Audio** : ambiance et retours sonores (immédiat, évents majeurs).
