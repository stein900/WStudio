# WStudio

Application de bureau (Electron) qui transforme du **Markdown (avec diagrammes Mermaid)** en **PDF professionnel** : sommaire paginé automatique, en-tête avec logo, pied de page, pages numérotées, typographie soignée. Pensée pour les rapports exigeants (réunions d'entreprise, écoles d'ingénieurs, mémoires techniques).

## Application de bureau

```bash
npm install
npm run dev    # ouvre l'application (rechargement à chaud)
npm run dist   # produit l'installeur et la version portable dans release/
```

Artefacts générés : `release/WStudio-Setup-<version>.exe` (installeur) et `release/WStudio-<version>-portable.exe` (exécutable autonome, sans installation).

## Projets

Au lancement, la **page d'accueil** liste les projets récents. Chaque projet vit dans son dossier :

```
Documents\WStudio\<Nom_du_projet>\
├── rapport.md     # le contenu (unique source de vérité, portable)
└── projet.json    # réglages de mise en page du projet
```

- **Sauvegarde automatique continue** : chaque modification (texte comme mise en page) est écrite dans le projet au bout d'une demi-seconde, plus un point de sauvegarde à la fermeture. Aucun bouton « Enregistrer ».
- **Nouveau projet** (Ctrl+N) : nom → dossier créé, document initialisé.
- **Importer un document…** : transforme un `.md` existant en projet.
- Depuis une carte projet : ouvrir, révéler le dossier, supprimer (corbeille, avec confirmation).
- La puce du projet dans la barre supérieure ouvre son dossier dans l'Explorateur.

Autres atouts de l'application :

- **Export PDF direct** : le fichier `.pdf` est écrit directement à l'emplacement choisi (moteur d'impression de Chromium, aucune boîte d'impression), puis révélé dans l'Explorateur.
- **Menu applicatif français** avec raccourcis : Ctrl+N (nouveau projet), Ctrl+O (accueil), Ctrl+S (enregistrer maintenant), Ctrl+E (export PDF), Ctrl+1/2 pour changer de mode, Ctrl+, pour la mise en page.
- **Polices embarquées** (Inter, JetBrains Mono) : fonctionne entièrement hors ligne.
- Géométrie de fenêtre mémorisée, instance unique.

## Version navigateur (optionnelle)

Pendant que `npm run dev` tourne, l'application est aussi accessible sur http://localhost:5173 dans un navigateur. L'export PDF passe alors par la boîte d'impression du navigateur (« Enregistrer au format PDF »).

## Flux de travail type

1. Cliquer sur **Prompt IA** : copier le prompt de conventions professionnelles (structure, style soutenu, jamais d'émoji, diagrammes Mermaid sobres…) et le donner à n'importe quelle IA avec votre sujet.
2. Coller le Markdown généré dans l'éditeur (mode **Markdown**, aperçu en direct à droite).
3. Ajuster au besoin en mode **Document** : édition type Google Docs (gras, souligné, images, tableaux…) — tout est retraduit en Markdown en arrière-plan, le fichier reste toujours du `.md` portable.
4. Régler **Mise en page** : logo et texte d'en-tête, pied de page, numérotation, sommaire automatique, police, taille.
5. **Exporter en PDF** : le fichier est écrit directement à l'emplacement choisi (application de bureau) ou via la boîte d'impression (navigateur).

## Fonctionnalités

- **Deux modes d'édition synchronisés** : source Markdown (CodeMirror) et traitement de texte (TipTap), le Markdown restant l'unique format de vérité.
- **Aperçu paginé exact** : le volet de droite du mode Markdown fait tourner le moteur d'export (Paged.js) en direct — les pages affichées (coupures, en-têtes, pieds, numéros, sommaire) sont exactement celles du PDF.
- **Mode Document paginé** : édition sur de vraies feuilles A4 séparées façon Google Docs (tiptap-pagination-plus), marges et en-têtes/pieds reflétant les réglages de mise en page.
- **Mermaid** rendu en direct dans l'aperçu et intégré en vectoriel dans le PDF (thème neutre professionnel).
- **LaTeX** (KaTeX, hors ligne) : `$…$` en ligne, `$$…$$` en bloc — rendu dans l'aperçu et le PDF, y compris dans les cellules de tableau ; les blocs d'équation ne sont jamais coupés entre deux pages. En mode Document, les formules restent en source `$…$` et survivent aux allers-retours sans corruption.
- **Sommaire automatique** : placer `[TOC]` sur une ligne seule (ou cocher l'option) — remplacé à l'export par un sommaire avec numéros de page réels (Paged.js `target-counter`).
- **En-tête / pied de page** : logo (image), texte, numérotation « n / total », en-tête masquable sur la première page.
- **Mise en page rapport** : chaque Titre 1 peut commencer sur une nouvelle page, veuves/orphelines contrôlées, tableaux et figures insécables, en-têtes de tableau répétés.
- **Fichiers** : ouverture/enregistrement `.md`, sauvegarde locale automatique (localStorage), images collées intégrées en base64 dans le Markdown.

## Notes techniques

- Export PDF : le document est paginé par [Paged.js](https://pagedjs.org). Dans l'application de bureau, le HTML paginé est chargé dans une fenêtre cachée puis converti par `printToPDF` (Chromium) et écrit directement sur disque ; dans le navigateur, il est imprimé via la boîte d'impression. Le polyfill est servi depuis `public/paged.polyfill.min.js`.
- `patches/app-builder-lib+*.patch` (appliqué par `patch-package` au `postinstall`) : sous Windows, le renommage du répertoire Electron fraîchement extrait peut être bloqué par un verrou externe (indexeur, antivirus, watcher d'IDE) — le patch réessaie puis bascule sur une copie récursive.
- Variables utiles aux tests : `RAPPORT_DIST=1` (charger `dist/` sans empaqueter), `RAPPORT_TEST_PDF=<chemin>` (export PDF sans dialogue).
- Les identifiants de titres sont préfixés `sec-` (un id commençant par un chiffre est un sélecteur CSS invalide et casse la pagination).
- Le marqueur `[TOC]` est restauré si l'éditeur Document l'échappe en `\[TOC\]`.

## Build de production

```bash
npm run build     # sortie dans dist/
npm run preview   # sert le build localement
```
