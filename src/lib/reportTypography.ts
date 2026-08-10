import type { PageSettings } from '../types'

export const FONT_STACKS = {
  sans: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', Times, serif",
}

export const MM_TO_PX = 96 / 25.4

/**
 * Marges de page CONSTANTES : l'en-tête et le pied de page vivent dans la
 * zone de marge, côté moteur de rendu — les activer, les modifier ou les
 * retirer ne déplace jamais le contenu et ne repagine pas le document.
 */
export function pageMarginsMm(_s?: PageSettings): { top: number; bottom: number; side: number } {
  return { top: 24, bottom: 22, side: 18 }
}

/**
 * Typographie du rapport — UNIQUE source de vérité, utilisée à la fois par
 * l'export PDF (scope '' → body) et par l'éditeur Document (scope
 * '.doc-page-canvas'). Toute divergence entre les deux ferait dériver la
 * pagination de l'éditeur par rapport au PDF.
 */
export function reportTypographyCss(s: PageSettings, scope = ''): string {
  const root = scope || 'body'
  const p = scope ? `${scope} ` : ''

  return `
${root} {
  font-family: ${FONT_STACKS[s.fontFamily]};
  font-size: ${s.fontSize}pt;
  line-height: 1.55;
  color: #1a1a1a;
  hyphens: auto;
}
${p}p { margin: 0 0 0.7em; text-align: justify; orphans: 3; widows: 3; }

${p}h1, ${p}h2, ${p}h3, ${p}h4 {
  font-family: ${FONT_STACKS.sans};
  color: #111;
  line-height: 1.25;
}
${p}h1 { font-size: 21pt; margin: 0 0 0.8em; }
${p}h2 { font-size: 15pt; margin: 1.4em 0 0.6em; padding-bottom: 0.15em; border-bottom: 0.6pt solid #ccc; }
${p}h3 { font-size: 12.5pt; margin: 1.2em 0 0.5em; }
${p}h4 { font-size: ${s.fontSize + 0.5}pt; margin: 1em 0 0.4em; }

${p}a { color: #1a4d8f; text-decoration: none; }

${p}ul, ${p}ol { margin: 0 0 0.8em; padding-left: 1.6em; }
${p}li { margin-bottom: 0.25em; }
/* PARITÉ éditeur↔PDF : TipTap enveloppe chaque <li> d'un <p> (0.7em de
   marge), le rendu markdown produit des listes serrées sans <p> — sans
   cette neutralisation, chaque puce décale la pagination de ~0.45em. */
${p}li > p { margin: 0; }

${p}blockquote {
  margin: 0.8em 0;
  padding: 0.4em 1em;
  border-left: 2.5pt solid #9aa7b5;
  background: #f5f7fa;
  color: #333;
}
${p}blockquote p { text-align: left; }

${p}code {
  font-family: Consolas, 'Courier New', monospace;
  font-size: ${s.fontSize - 1.5}pt;
  background: #f2f3f5;
  padding: 0.1em 0.35em;
  border-radius: 3px;
}
${p}pre {
  background: #f6f8fa;
  border: 0.5pt solid #d8dde3;
  border-radius: 4px;
  padding: 0.8em 1em;
  margin: 0.9em 0;
}
${p}pre code {
  background: none;
  padding: 0;
  font-size: ${s.fontSize - 2}pt;
  white-space: pre-wrap;
  word-break: break-word;
}

${p}table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.9em 0;
  font-size: ${s.fontSize - 1}pt;
}
${p}th, ${p}td {
  border: 0.5pt solid #c4cad1;
  padding: 0.4em 0.7em;
  vertical-align: top;
  overflow-wrap: break-word;
  text-align: left;
}
${p}td code, ${p}th code { word-break: break-word; }
${p}th { background: #eef1f4; font-weight: 600; }
${p}tbody tr:nth-child(even) { background: #fafbfc; }

${p}img { max-width: 100%; height: auto; }

${p}hr { border: none; border-top: 0.6pt solid #ccc; margin: 1.5em 0; }

${p}.mermaid-diagram, ${p}.mermaid-nodeview {
  text-align: center;
  margin: 1.1em 0;
  max-width: 100%;
  overflow: hidden;
}
${p}.mermaid-diagram svg, ${p}.mermaid-nodeview svg {
  max-width: 100% !important;
  max-height: 225mm !important;
  height: auto !important;
}
${p}.mermaid-error {
  border: 1pt solid #c0392b;
  background: #fdf0ee;
  color: #7b241c;
  padding: 0.8em 1em;
  font-size: 9pt;
  text-align: left;
}
${p}.mermaid-error pre { background: none; border: none; padding: 0.4em 0; }
`
}
