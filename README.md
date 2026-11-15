# RailRadar

Carte en direct des trains français (TGV INOUI, OUIGO, Intercités, TER, trains internationaux),
avec les retards réels. Site 100 % statique : aucune clé d'API, aucun serveur, aucun build.

## Comment ça marche

- La SNCF ne publie pas la position GPS des trains. Elle publie en open data, toutes les deux
  minutes environ, les horaires réels de chaque train à chaque arrêt (flux GTFS-RT, sans clé).
- Le navigateur lit ce flux directement, calcule le chemin de chaque train sur le réseau ferré
  (`public/data/rail.json`) et le déplace entre ses deux arrêts selon l'horaire recalé du retard.
- Positions et vitesses sont donc des **estimations**.

## Organisation

- `public/` : le site (c'est ce dossier que Netlify publie)
- `public/data/` : réseau ferré et gares, déjà générés
- `tools/build_data.py` : régénère ces deux fichiers (facultatif, une ou deux fois par an)
- `netlify.toml` : réglage Netlify (dossier publié = `public`)

## Tester sur son ordinateur

```bash
python3 -m http.server 5173 --directory public
```

Puis ouvrir http://localhost:5173

## Publier

1. Sur github.com : **New repository**, nom `railradar`, sans README, **Create repository**.
2. Sur la page du dépôt : **uploading an existing file**, glisser tout le contenu de ce dossier
   (`public`, `tools`, `netlify.toml`, `README.md`, `.gitignore`), puis **Commit changes**.
3. Sur app.netlify.com : **Add new site > Import an existing project > GitHub**, choisir le dépôt.
   Laisser la commande de build vide ; le dossier publié (`public`) est lu dans `netlify.toml`.
4. **Deploy**. Le site est en ligne ; chaque modification poussée sur GitHub le redéploie.

## Changer le nom du site

Constante `SITE_NAME` en haut de `public/js/app.js`, et le titre dans `public/index.html`.

## Rafraîchir le réseau et les gares

```bash
python3 tools/build_data.py
```

## Sources et licences

Horaires temps réel et réseau : open data SNCF / SNCF Réseau via transport.data.gouv.fr (ODbL).
Quelques tronçons (`tools/patches.geojson`) et le fond de carte : © les contributeurs
OpenStreetMap (ODbL), tuiles OpenFreeMap. Vue satellite : © IGN. Site indépendant de la SNCF.
