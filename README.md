# WStudio

**WStudio** (« Writer Studio ») est une application de bureau Windows (Electron + React) : un **studio de documents** tout-en-un, entièrement en français et fonctionnant **hors ligne** (polices, KaTeX et moteurs embarqués). Elle réunit cinq modules autour d'une même page d'accueil :

| Module | En bref |
|---|---|
| **Documents** | Rédaction de rapports en Markdown, aperçu paginé fidèle, export **PDF professionnel** (sommaire, en-têtes, LaTeX, Mermaid) |
| **Tableur** | Feuilles de calcul multi-onglets, formules, import/export Excel (`.xlsx`, `.xls`) et CSV |
| **Paint** | Dessins et schémas vectoriels à main levée : formes, flèches, calques, lissage du trait, export PNG |
| **Éditeur PDF** | Modifier un PDF existant : remplacer/effacer du texte, ajouter texte libre, formes et images |
| **Outils PDF** | Fusionner plusieurs PDF (avec réorganisation) et compresser un PDF |

S'y ajoute un **assistant IA intégré** (Claude, OpenAI ou toute API compatible) capable de corriger, reformuler ou modifier un document entier — chaque proposition passant par une revue de diff à accepter/refuser.

WStudio s'enregistre comme application capable d'ouvrir les `.pdf` de Windows (« Ouvrir avec ») : un double-clic sur un PDF ouvre directement l'Éditeur PDF.

---

## Sommaire

- [Installation et lancement](#installation-et-lancement)
- [Accueil, projets et fichiers](#accueil-projets-et-fichiers)
- [Module Documents (rapports Markdown → PDF)](#module-documents-rapports-markdown--pdf)
- [Module Tableur](#module-tableur)
- [Module Paint](#module-paint)
- [Module Éditeur PDF](#module-éditeur-pdf)
- [Module Outils PDF](#module-outils-pdf)
- [Assistant IA](#assistant-ia)
- [Raccourcis clavier](#raccourcis-clavier)
- [Où atterrissent les fichiers produits](#où-atterrissent-les-fichiers-produits)
- [Architecture technique](#architecture-technique)
- [Notes techniques](#notes-techniques)

---

## Installation et lancement

```bash
npm install
npm run dev    # ouvre l'application de bureau (rechargement à chaud)
npm run dist   # produit l'installeur et la version portable dans release/
```

Artefacts générés par `npm run dist` :

- `release/WStudio-Setup-<version>.exe` — installeur NSIS (enregistre aussi l'association `.pdf`) ;
- `release/WStudio-<version>-portable.exe` — exécutable autonome, sans installation.

**Version navigateur (optionnelle)** : pendant que `npm run dev` tourne, l'interface est aussi accessible sur http://localhost:5173. Ce mode est réduit : pas de page d'accueil ni de projets (démarrage direct dans l'éditeur, sauvegarde en `localStorage`), pas d'assistant IA, et l'export PDF passe par la boîte d'impression du navigateur (« Enregistrer au format PDF »).

---

## Accueil, projets et fichiers

Au lancement, la **page d'accueil** présente la barre des cinq modules (avec bascule thème clair/sombre, mémorisée) et la liste des projets récents de la section active — **Documents** ou **Tableur** ; Paint, Éditeur PDF et Outils PDF sont des vues plein écran sans projets.

Chaque projet vit dans son propre dossier sous `Documents\WStudio\` :

```
Documents\WStudio\<Nom_du_projet>\
├── rapport.md      # projet Document : le contenu (unique source de vérité, portable)
│   — ou —
├── classeur.json   # projet Tableur : les feuilles au format interne
├── projet.json     # réglages (mise en page du rapport, ou type/date du tableur)
└── assets\         # images du rapport (img-<hash>.png…), jamais de base64 dans le .md
```

Trois façons de créer, dans chaque section :

- **Nouveau projet / Nouveau tableur** (Ctrl+N) : modale de nommage ; un document est initialisé avec titre + `[TOC]` + première section.
- **Importer…** : un `.md`/`.markdown`/`.txt` devient un projet Document ; un `.xlsx`/`.xlsm`/`.xls`/`.csv` devient un projet Tableur.
- **Projet / Tableur temporaire** : créé dans `%TEMP%\WStudio Temporaire\`, jamais listé sur l'accueil, nettoyé par Windows — pour essayer ou produire vite sans rien laisser dans ses documents.

Les cartes de projet affichent une vraie **vignette** (première page rendue du rapport, ou coin de la première feuille du classeur), la date relative de modification, le nombre de mots ou de feuilles/cellules, et deux actions : ouvrir le dossier dans l'Explorateur, supprimer (confirmation native, envoi **à la corbeille**, uniquement sous `Documents\WStudio`).

**Sauvegarde automatique continue** partout : chaque modification est écrite au bout d'une demi-seconde (1 s pour le tableur, plus un filet toutes les 10 s), avec un point de sauvegarde forcé à la fermeture et au retour à l'accueil. Aucun bouton « Enregistrer » — Ctrl+S force simplement une écriture immédiate.

---

## Module Documents (rapports Markdown → PDF)

Le cœur historique de WStudio : transformer du **Markdown** en **PDF professionnel** — sommaire paginé automatique, en-tête avec logo, pied de page numéroté, typographie soignée. Pensé pour les rapports exigeants (entreprise, écoles d'ingénieurs, mémoires techniques).

### Deux modes d'édition synchronisés

- **Mode Markdown** (Ctrl+1) : source dans CodeMirror à gauche, **aperçu paginé exact** à droite — le volet fait tourner le moteur d'export (Paged.js) en direct : les pages affichées (coupures, en-têtes, pieds, numéros, sommaire) sont exactement celles du PDF.
- **Mode Document** (Ctrl+2) : édition type Google Docs (TipTap) sur de vraies feuilles A4 séparées, marges et bandes d'en-tête/pied reflétant la mise en page. Tout est retraduit en Markdown en arrière-plan : le fichier reste un `.md` portable, unique source de vérité.

### Contenu riche

- **LaTeX** (KaTeX, hors ligne) : `$…$` en ligne, `$$…$$` en bloc, `\tag{…}` aligné à droite, y compris dans les cellules de tableau. Les blocs d'équation ne sont jamais coupés entre deux pages ; une équation plus large que la page est réduite homothétiquement, uniquement si elle déborde réellement.
- **Mermaid** : diagrammes rendus en direct dans l'aperçu et intégrés en vectoriel dans le PDF (thème neutre professionnel).
- **Coloration syntaxique** des blocs de code (highlight.js).
- **Images** : collées ou insérées, stockées en fichiers dans `assets\` (nom stable par empreinte — zéro doublon) ; les images base64 d'un Markdown importé sont extraites automatiquement.
- **Sommaire automatique** : placer `[TOC]` sur une ligne seule (ou cocher l'option) — remplacé à l'export par un sommaire avec **numéros de page réels**.
- **Recherche/remplacement** dans l'éditeur.

### Mise en page (Ctrl+,)

Panneau « Mise en page » enregistré dans `projet.json` :

- **En-tête** : texte (alignement, taille, décalage vertical) et/ou logo (image, position, hauteur, décalage), masquable sur la première page.
- **Pied de page** : texte (alignement, taille, décalage) et numérotation « n / total ».
- **Document** : police (sans-serif Inter ou serif), taille du corps, chaque Titre 1 sur une nouvelle page, sommaire automatique.

À l'export, veuves/orphelines sont contrôlées, les tableaux et figures sont insécables (en-têtes de tableau répétés), les titres ne restent jamais seuls en bas de page.

### Export PDF (Ctrl+E)

Le document est paginé par [Paged.js](https://pagedjs.org) puis converti par le moteur d'impression de Chromium (`printToPDF`) dans une fenêtre cachée — **aucune boîte d'impression**, le `.pdf` est écrit directement à l'emplacement choisi puis révélé dans l'Explorateur. Un second chemin d'export imprime directement le webview de l'aperçu (fidélité garantie par construction).

### Flux de travail type

1. **Prompt IA** : copier la charte de rédaction intégrée et la donner à n'importe quelle IA avec votre sujet (voir [Assistant IA](#assistant-ia)).
2. Coller le Markdown généré en mode Markdown, aperçu en direct à droite.
3. Ajuster en mode Document (gras, images, tableaux…) — ou laisser l'agent IA intégré s'en charger.
4. Régler la mise en page (logo, pied, sommaire, police).
5. Exporter en PDF.

---

## Module Tableur

Feuilles de calcul fondées sur `x-data-spreadsheet` (grille) et SheetJS (fichiers), interface entièrement francisée.

- **Grille complète** : gras/italique/souligné/barré, polices et tailles, couleurs de texte et de fond, bordures, alignements, renvoi à la ligne, fusion de cellules, volets figés, filtres, tri, validation de données, formats de nombre (%, monnaies, dates, durées), reproduction de mise en forme.
- **Formules** : `SUM`, `AVERAGE`, `MAX`, `MIN`, `IF`, `AND`, `OR`, `CONCAT` (pas de RECHERCHEV ni de références inter-feuilles — ce n'est pas un moteur Excel complet).
- **Feuilles multiples** : onglets en bas (`Feuille2`, `Feuille3`…), renommage par double-clic.
- **Import** : `.xlsx`, `.xlsm`, `.xls`, `.csv` (bouton ou glisser-déposer ; confirmation si le classeur courant n'est pas vide — l'import remplace tout). CSV : UTF-8 avec repli Windows-1252 (fichiers Excel français).
- **Export** : classeur complet en `.xlsx` (valeurs, formules, fusions, largeurs/hauteurs) ; feuille affichée en `.csv` (séparateur `;`, BOM UTF-8 — ouverture propre dans Excel FR).
- **Autosauvegarde** dans `classeur.json` (débounce 1 s + filet 10 s + flush à la fermeture).

Limite à connaître : la **mise en forme ne traverse pas l'import/export xlsx** (limite de SheetJS édition communautaire) — couleurs et bordures sont conservées dans le projet WStudio mais perdues dans le fichier `.xlsx` exporté.

---

## Module Paint

Éditeur de **schémas vectoriels** à main levée — pensé pour produire vite un croquis propre à coller dans un rapport.

- **Outils** : sélection/déplacement (V), crayon lissé (P), ligne (L), flèche (F), rectangle arrondi (R), ellipse (E), texte multi-lignes (T), gomme d'objet (G). Maj contraint à 45° ou au carré/cercle.
- **Style** : 7 couleurs + sélecteur libre, 3 épaisseurs, remplissage translucide optionnel des boîtes.
- **Lissage du trait** réglable 0–100 % : amortissement pendant le tracé puis moyenne glissante + simplification Ramer-Douglas-Peucker au lâcher — le trait tremblé devient une courbe régulière.
- **Calques** : créer, renommer, masquer, réordonner, supprimer ; le dessin va sur le calque actif, la gomme n'efface que lui.
- **Édition** : poignées de redimensionnement sur chaque objet, annuler/rétablir (Ctrl+Z / Ctrl+Y, 100 étapes), Suppr, grille de repère (jamais exportée).
- **Sortie** : **export PNG** (`schema.png`, calques visibles, cadré sur le contenu, rendu ×2, fond blanc) ou **Copier** dans le presse-papiers — coller ensuite directement dans un rapport (l'image est alors rangée dans les `assets\` du projet).

Le dessin est **unique et persistant** (restauré à chaque retour dans le module, stocké en `localStorage`) : pas de fichiers de dessin multiples.

---

## Module Éditeur PDF

Ouvre un **PDF existant** (bouton, glisser-déposer, ou double-clic dans Windows grâce à l'association « Ouvrir avec ») et permet de le modifier. Vue continue de toutes les pages, rendu paresseux (les pages hors écran libèrent leur mémoire), zoom par paliers.

- **Modifier le texte existant** : chaque fragment de texte est cliquable ; on tape le remplacement (aperçu dans une police approchante) ou on vide le champ pour **effacer**. À l'enregistrement, la zone d'origine est recouverte de la couleur de fond détectée puis le nouveau texte est redessiné sur la même ligne de base, dans la police standard la plus proche (Helvetica/Times/Courier, gras/italique détectés). La détection d'encre évite d'effacer les filets de tableau qui traversent la zone, et le texte plus long s'étire dans l'espace libre avant d'être rétréci.
- **Ajouter** : texte libre multi-lignes (7 couleurs, tailles 10 à 32 pt), rectangles et ellipses (contour/remplissage/épaisseur), images (re-encodées proprement en PNG/JPEG, orientation EXIF appliquée). Tout est déplaçable et redimensionnable.
- **Panneau « Modifications »** : liste triée par page de toutes les éditions, clic pour y sauter, annulation individuelle ou totale.
- **Enregistrement** : le fichier d'origine n'est **jamais modifié** — une copie `<nom>-modifié.pdf` est produite (pdf-lib).

Limites : pas de gestion de pages (voir Outils PDF), texte réécrit toujours en noir et en police standard (encodage WinAnsi : le français passe, pas le cyrillique/CJK), fragments horizontaux uniquement, rien n'est persisté avant l'export.

---

## Module Outils PDF

Deux opérations sur documents entiers :

- **Fusionner** : ajouter plusieurs PDF (multi-sélection ou glisser-déposer), chaque document apparaissant en carte avec vignette, nombre de pages et poids ; réorganiser avec les flèches, retirer, puis exporter `fusion.pdf` dans l'ordre affiché.
- **Compresser** :
  - *Sans perte* — réécriture compacte du fichier (contenu strictement identique, gain typique 5–20 %) ;
  - *Forte / Moyenne / Légère* — chaque page est re-rendue en image JPEG (trois préréglages qualité/résolution, barre de progression). Gain massif, mais la couche texte disparaît (plus de sélection ni de recherche — signalé dans l'interface).
  - Résultat affiché : `poids avant → après (−x %)`, export `<nom>-compressé.pdf`.

Les originaux ne sont jamais modifiés. Pas de découpe/extraction/rotation page à page à ce jour.

---

## Assistant IA

Panneau latéral intégré à l'éditeur de rapports (Ctrl+Maj+A), disponible dans l'application de bureau.

### Fournisseurs et profils

Multi-profils : **Anthropic (Claude)** — modèle par défaut `claude-opus-5` —, **OpenAI**, **OpenRouter**, **Groq**, ou **toute API compatible OpenAI** (URL de base libre : Ollama, LM Studio, serveur d'entreprise…). On crée autant de profils que voulu et on choisit l'actif dans une liste déroulante.

Les **clés API ne quittent jamais le processus principal** d'Electron : elles sont chiffrées par `safeStorage` (DPAPI Windows) dans `%APPDATA%\WStudio\ai-config.json`, et l'interface ne reçoit qu'un profil public sans clé.

### Actions

- **Sur la sélection** (mode Markdown) : *Corriger l'orthographe* (correcteur strict : orthographe, grammaire, typographie française — jamais de reformulation), *Reformulation professionnelle* (registre soutenu, structure préservée), ou **consigne libre**.
- **Sur le document entier** (les deux modes) : l'**agent** reçoit tout le Markdown et une consigne libre, et propose des modifications ciblées ancrées sur des citations exactes du texte. Une ancre introuvable ou ambiguë est rejetée plutôt qu'appliquée au mauvais endroit.
- **Rien n'est appliqué sans validation** : chaque proposition passe par une **revue de diff** — hunks ligne à ligne avec position, raison donnée par le modèle, suppressions en rouge / ajouts en vert, boutons Accepter/Refuser par hunk, garde-fou si plus de 30 % du document serait remplacé. L'application préserve l'historique Ctrl+Z.
- Réponse **diffusée en direct**, annulable ; messages d'erreur explicites (clé invalide, quota, modèle introuvable, réponse tronquée…).

### Le « Prompt IA » (sans clé API)

Bouton distinct de la barre supérieure : affiche et copie en un clic une **charte de rédaction professionnelle** (~50 lignes) à coller dans n'importe quelle IA externe — format Markdown attendu (`[TOC]`, hiérarchie numérotée, KaTeX), style soutenu sans émoji, règles d'usage des tableaux, diagrammes Mermaid sobres. L'IA externe produit alors un Markdown directement exploitable par WStudio.

---

## Raccourcis clavier

| Raccourci | Action |
|---|---|
| `Ctrl+N` | Nouveau projet |
| `Ctrl+O` | Accueil — tous les projets |
| `Ctrl+S` | Enregistrer maintenant (l'autosauvegarde tourne déjà en continu) |
| `Ctrl+E` | Exporter en PDF |
| `Ctrl+1` / `Ctrl+2` | Mode Markdown / mode Document |
| `Ctrl+,` | Mise en page |
| `Ctrl+Maj+A` | Assistant IA |
| `Ctrl+Z` / `Ctrl+Y` | Annuler / rétablir (éditeurs et Paint) |

Le menu applicatif (français) reprend toutes ces actions ; l'appli mémorise la géométrie de sa fenêtre et n'autorise qu'une **instance unique** (un second lancement — par exemple un double-clic sur un PDF — est routé vers la fenêtre existante).

---

## Où atterrissent les fichiers produits

| Production | Destination |
|---|---|
| Projets Documents / Tableur, images `assets\` | `Documents\WStudio\<Projet>\` (autosauvegarde) |
| Export **PDF d'un rapport** | Emplacement **choisi** (boîte native), puis révélé dans l'Explorateur |
| Enregistrement `.md` (« Enregistrer sous ») | Emplacement choisi (boîte native) |
| Exports Tableur (`.xlsx`, `.csv`), PNG Paint, PDF modifié, `fusion.pdf`, PDF compressé | **Dossier Téléchargements** (téléchargement type navigateur, nom prédéfini) |

Les fichiers ouverts (PDF, classeurs importés) ne sont **jamais modifiés en place** : toute sortie est une copie.

---

## Architecture technique

**Stack** : Electron (processus principal `electron/main.cjs`, préload à pont `contextBridge`), React 19 + TypeScript + Vite, CodeMirror 6 (source Markdown), TipTap/ProseMirror (mode Document, pagination A4 via `tiptap-pagination-plus`), markdown-it + KaTeX + Mermaid + highlight.js (rendu), Paged.js (pagination d'export), pdf.js (lecture/rendu PDF), pdf-lib (écriture PDF), x-data-spreadsheet + SheetJS (tableur), SDK Anthropic et OpenAI (assistant).

Points notables :

- **Un seul format de vérité** pour les rapports : le Markdown. Le mode Document, l'aperçu et le PDF en dérivent tous ; l'aperçu paginé exécute le même moteur que l'export, donc les coupures affichées sont celles du PDF.
- **Export PDF** : HTML autonome (Markdown rendu + CSS d'impression + Paged.js) chargé dans une fenêtre cachée, attente de la fin de pagination, puis `printToPDF` de Chromium — écriture directe sur disque.
- **Sécurité du renderer** : `contextIsolation` activé, pas d'accès Node ni disque côté interface — tout passe par des IPC dédiés (projets, assets, export, IA). Navigation externe bloquée, liens ouverts dans le navigateur système.
- **Protocole interne `wstudio://`** : sert les vignettes/images de projets (restreint aux racines de projets) et les ressources pdf.js en production `file://` (polices standard, CMaps).
- **Clés API** chiffrées via `safeStorage`, appels réseau exécutés uniquement dans le processus principal.
- **Polices embarquées** (Inter, JetBrains Mono) : aucun accès réseau requis à l'usage.

---

## Notes techniques

- `patches/app-builder-lib+*.patch` (appliqué par `patch-package` au `postinstall`) : sous Windows, le renommage du répertoire Electron fraîchement extrait peut être bloqué par un verrou externe (antivirus, indexeur) — le patch réessaie puis bascule sur une copie récursive.
- Variables utiles aux tests : `RAPPORT_DIST=1` (charger `dist/` sans empaqueter — le build se fait par `npx tsc -b && npx vite build`), `RAPPORT_TEST_PDF=<chemin>` (export PDF sans dialogue).
- KaTeX est **dédupliqué** (`resolve.dedupe` dans `vite.config.ts`) : le plugin markdown-it-katex embarque sa propre copie 0.16 dont le markup ne correspond pas à la CSS 0.18 de l'app (tags `\tag` mal positionnés sinon).
- Les identifiants de titres sont préfixés `sec-` (un id commençant par un chiffre est un sélecteur CSS invalide et casse la pagination).
- Le marqueur `[TOC]` est restauré si l'éditeur Document l'échappe en `\[TOC\]`.
