# RailRadar

Carte en direct des trains en France (TGV INOUI, OUIGO, Intercités, TER, internationaux) et, en zoomant,
des réseaux urbains : RER, Transilien, métro, tram, Orlyval et CDGVAL en Île-de-France, métro et tram
de Lille, tram et bus express G de Bordeaux.

## D'où viennent les positions

| Réseau | Source | Précision |
| --- | --- | --- |
| Trains SNCF | flux temps réel SNCF (open data, sans clé) | position estimée d'après les retards réels |
| Transilien et branches RER présents dans le flux SNCF | même flux SNCF | retards réels, sans clé |
| Métro, RER, Transilien, tram d'Île-de-France | horaires IDFM + API PRIM (clé gratuite) | retards réels si la clé PRIM est configurée, sinon horaire prévu |
| Tram de Lille | horaires Ilévia + prochains passages temps réel Ilévia | retards réels |
| Métro de Lille | horaires Ilévia + alertes de perturbation | horaire prévu (Ilévia ne publie pas de temps réel pour le métro) |
| Tram et bus G de Bordeaux | flux GPS TBM | **position GPS réelle** |

## Organisation

- `public/` : le site (dossier publié par Netlify)
- `public/data/` : réseau ferré et gares SNCF, déjà générés
- `netlify/functions/idfm.mjs` : relais qui interroge l'API PRIM avec votre clé, sans jamais l'exposer
- `.github/workflows/urban-data.yml` : tâche GitHub qui régénère chaque nuit les horaires urbains
- `tools/build_urban.py` : générateur des horaires urbains (lancé par la tâche de nuit)
- `tools/build_data.py` : générateur du réseau SNCF (à relancer une ou deux fois par an)
- `tools/dev_server.py` : serveur de test local
- `.env` : votre clé PRIM pour les tests locaux (**ne jamais l'envoyer sur GitHub**)

## Tester sur son ordinateur

```bash
python3 tools/build_urban.py
```

```bash
python3 tools/dev_server.py
```

Puis ouvrir http://localhost:5173. La première commande fabrique les horaires urbains du jour dans
`public/urban/` ; la seconde sert le site et utilise la clé PRIM du fichier `.env` si elle est remplie.

## Combien ça coûte

- **GitHub** : gratuit. Les tâches automatiques sont gratuites et illimitées sur un dépôt public.
- **Netlify** (plan gratuit, 300 crédits par mois) : chaque mise en ligne coûte 15 crédits, donc
  20 modifications par mois au plus. Les horaires de la nuit ne passent **pas** par Netlify
  (ils sont lus directement sur GitHub) : ils ne coûtent rien.
- **Relais PRIM** : sa réponse est mise en cache 3 minutes, donc PRIM est interrogé au plus 480 fois
  par jour (quota de la clé : 1 000 requêtes par jour) et seulement quand quelqu'un regarde
  l'Île-de-France. Chaque appel prend environ 4 secondes de calcul : même si quelqu'un regardait
  Paris jour et nuit sans arrêt, cela resterait sous 200 crédits par mois ; en usage normal, beaucoup moins.
- Si les 300 crédits sont épuisés, Netlify met le site en pause jusqu'au mois suivant.

## Publier (pas à pas)

### 1. La clé PRIM (temps réel Île-de-France)

1. Créez un compte sur https://prim.iledefrance-mobilites.fr et confirmez votre adresse e-mail.
2. Dans votre espace, générez votre jeton (clé API) et copiez-le.
3. Pour tester en local : collez-le dans le fichier `.env` après `PRIM_API_KEY=`.

### 2. Le dépôt GitHub

1. Sur github.com : **New repository**, nom `railradar`, visibilité **Public** (nécessaire pour que
   les tâches de nuit soient gratuites et que le site puisse lire les horaires), sans README.
2. Envoyez le contenu du dossier, **sauf** le fichier `.env` et le dossier `public/urban/`.
   Sur Mac, le dossier `.github` est caché : appuyez sur Cmd + Maj + . dans le Finder pour l'afficher.
3. L'adresse des horaires est inscrite dans `public/js/app.js` (ligne `GITHUB_DATA`) :
   `Antoineeeuu/rainradar`. À modifier seulement si le dépôt change de nom.

### 3. La tâche de nuit

1. Dans le dépôt : onglet **Actions**, acceptez l'activation des workflows si GitHub le demande.
2. Choisissez **Horaires urbains**, puis **Run workflow** pour un premier lancement immédiat.
3. Après 2 à 3 minutes, une branche `data` apparaît : ce sont les horaires du jour.
   La tâche se relance ensuite seule chaque nuit.

> GitHub suspend les tâches planifiées d'un dépôt public sans activité pendant 60 jours. Il envoie
> alors un e-mail : un clic sur **Enable workflow** dans l'onglet Actions suffit à les relancer.

### 4. Netlify

1. app.netlify.com : **Add new site → Import an existing project → GitHub**, choisissez le dépôt.
   Laissez la commande de build vide (le dossier publié est indiqué dans `netlify.toml`).
2. **Site configuration → Environment variables → Add a variable** : nom `PRIM_API_KEY`,
   valeur = votre clé PRIM.
3. **Deploys → Trigger deploy** pour prendre la clé en compte.

## Changer le nom du site

Constante `SITE_NAME` en haut de `public/js/app.js`, et le titre dans `public/index.html`.

## Sources et licences

Open data SNCF et SNCF Réseau (ODbL), Île-de-France Mobilités (PRIM, ODbL), Ilévia / Métropole
Européenne de Lille, TBM / Bordeaux Métropole, via transport.data.gouv.fr. Tracés complémentaires
(`tools/patches.geojson`, `tools/lille_osm.geojson`) et fond de carte : © les contributeurs
OpenStreetMap (ODbL), tuiles OpenFreeMap. Vue satellite : © IGN. Site indépendant, sans lien avec ces
opérateurs.
