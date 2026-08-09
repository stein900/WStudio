export const DEFAULT_DOC = `# Titre du rapport

[TOC]

## 1. Introduction

Ce document est un exemple. Remplacez son contenu par votre rapport, ou collez ici le Markdown généré par une IA à partir du bouton « Prompt IA ».

La ligne \`[TOC]\` ci-dessus sera remplacée à l'export par un sommaire automatique avec numéros de page (activez l'option dans « Mise en page »).

## 2. Fonctionnalités

### 2.1 Mise en forme

Le texte peut être en **gras**, en *italique*, en \`code\`, ou <u>souligné</u>. Les tableaux sont pris en charge :

| Critère | Option A | Option B |
| --- | --- | ---: |
| Coût | Faible | 12 000 € |
| Délai | 3 mois | 6 mois |

*Tableau 1 — Exemple de comparaison.*

### 2.2 Diagrammes Mermaid

\`\`\`mermaid
flowchart LR
    A["Markdown"] --> B["Aperçu en direct"]
    B --> C["Export PDF"]
    C --> D["Document final"]
\`\`\`

*Figure 1 — Chaîne de production du document.*

## 3. Conclusion

Passez en mode « Document » pour une édition type traitement de texte, puis exportez en PDF via le bouton dédié.
`
