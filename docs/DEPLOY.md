# Déploiement sur Render

L'application est un **unique service web Node** : un serveur HTTP qui sert le
client compilé et une salle de jeu WebSocket sur `/ws`. Aucun disque, aucune base
de données, aucun build Docker nécessaire.

## Option A — Blueprint (`render.yaml`)

1. Render → **New** → **Blueprint**.
2. Choisir le dépôt `benjaminb3012/OpenWars` et la branche à déployer
   (`main` une fois les changements fusionnés, ou directement la branche de
   travail).
3. Render lit `render.yaml` : build `npm ci --include=dev && npm run build`,
   start `npm start`, health check `/healthz`.
4. Déployer, puis ouvrir l'URL fournie.

## Option B — Service existant (`openwars-logd`)

Dans **Settings** du service :

| Réglage | Valeur |
| --- | --- |
| Environment | Node |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |
| Auto-Deploy | On |

Variables d'environnement utiles :

```
NODE_VERSION=22.22.3
MAP_WIDTH=320
MAP_HEIGHT=200
MAP_SEED=1337
MAP_STYLE=continents   # continents | archipelago | pangaea
MAX_PLAYERS=8
BOTS=6
TICK_RATE=10
```

`PORT` est fourni automatiquement par Render ; le serveur écoute sur `0.0.0.0`
(obligatoire pour le proxy Render et pour l'aperçu Arena).

## Vérifications après déploiement

```bash
curl -s https://<ton-service>.onrender.com/healthz
# {"ok":true,"tick":0,"players":0,"humans":0,"clients":0}

curl -s https://<ton-service>.onrender.com/api/config
curl -s -o /dev/null -w "%{http_code}\n" https://<ton-service>.onrender.com/
```

Puis ouvrir la page : le menu de sélection de nation doit apparaître, suivre
« Rejoindre la partie » et vérifier que le HUD se remplit.

## Comportement sur l'offre gratuite

- Le service s'endort après inactivité : au réveil, `/healthz` répond et le
  monde repart **là où il s'était arrêté** (le tick est conservé en mémoire).
- **Aucun client connecté ⇒ simulation en pause** : pas de consommation CPU
  inutile, et pas de monde qui évolue sans joueur.
- Redémarrer le service réinitialise le monde (pas de persistance).
- Une seule instance : ne pas mettre `numInstances > 1` (deux simulations
  concurrentes). Pour plusieurs salles, il faudra un coordinateur.

## Notes techniques

- Le serveur n'embarque pas `ws` dans son bundle (dépendance résolue depuis
  `node_modules`), donc `npm ci` doit être exécuté au build — c'est le cas des
  commandes ci-dessus.
- `npm run build` exécute le typecheck strict puis le bundle esbuild ; un type
  invalide fait échouer le déploiement volontairement.
- Journaux utiles : `[openwars] match started …`, `player #n joined …`,
  `player #n disconnected -> AI takeover`, `resuming after a … ms pause`.
