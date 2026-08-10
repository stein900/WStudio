/**
 * En-tête et pied de page du rendu — UNIQUE source de vérité, partagée par
 * l'export PDF (Paged.js, boîtes de marge) et l'éditeur Document
 * (tiptap-pagination-plus, bandes de page). Bande en grille trois zones
 * (gauche / centre / droite) : le logo et chaque texte se placent dans la
 * zone choisie, avec leur taille propre — tout est côté moteur de rendu,
 * jamais dans le Markdown, et n'influence pas la pagination du contenu
 * (marges de page constantes, voir pageMarginsMm).
 */

import type { HfAlign, PageSettings } from '../types'
import { escapeHtml } from './markdown'
import { FONT_STACKS } from './reportTypography'

function cells(parts: Record<HfAlign, string[]>): string {
  return (
    `<div class="ws-hf-l">${parts.left.join('')}</div>` +
    `<div class="ws-hf-c">${parts.center.join('')}</div>` +
    `<div class="ws-hf-r">${parts.right.join('')}</div>`
  )
}

export function hasHeader(s: PageSettings): boolean {
  return Boolean(s.headerText || s.headerLogo)
}

export function hasFooter(s: PageSettings): boolean {
  return Boolean(s.footerText || s.pageNumbers)
}

/** Bande d'en-tête (logo + texte, chacun dans sa zone). */
export function buildHeaderHtml(s: PageSettings): string {
  const parts: Record<HfAlign, string[]> = { left: [], center: [], right: [] }
  if (s.headerLogo)
    parts[s.headerLogoAlign].push(`<img class="ws-hf-logo" src="${s.headerLogo}" alt="logo">`)
  if (s.headerText)
    parts[s.headerTextAlign].push(`<span class="ws-hf-text">${escapeHtml(s.headerText)}</span>`)
  return `<div class="ws-hf ws-header">${cells(parts)}</div>`
}

/**
 * Bande de pied de page. `pageNumHtml` : contenu du compteur de pages —
 * '' pour l'export (le numéro est produit en CSS via counter(page)),
 * '{page}' pour l'éditeur Document (jeton remplacé par le plugin).
 */
export function buildFooterHtml(s: PageSettings, pageNumHtml: string): string {
  const parts: Record<HfAlign, string[]> = { left: [], center: [], right: [] }
  if (s.footerText)
    parts[s.footerTextAlign].push(`<span class="ws-hf-text">${escapeHtml(s.footerText)}</span>`)
  if (s.pageNumbers) parts.right.push(`<span class="ws-pagenum">${pageNumHtml}</span>`)
  return `<div class="ws-hf ws-footer">${cells(parts)}</div>`
}

/** Styles des bandes — unités pt/mm, identiques à l'écran et à l'impression. */
export function headerFooterCss(s: PageSettings): string {
  return `
.ws-hf {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 4mm;
  width: 100%;
  font-family: ${FONT_STACKS[s.fontFamily]};
}
.ws-hf-l, .ws-hf-c, .ws-hf-r { display: flex; align-items: center; gap: 3mm; min-width: 0; }
.ws-hf-l { justify-content: flex-start; }
.ws-hf-c { justify-content: center; }
.ws-hf-r { justify-content: flex-end; }
.ws-header {
  padding-bottom: 2mm;
  border-bottom: 0.4pt solid #b5b5b5;
  color: #444;
}
/* Décalages verticaux en transform : pur déplacement de PEINTURE — un
   transform ne participe jamais à la mise en page, il ne peut donc ni
   agrandir la bande ni pousser quoi que ce soit. (inline-block requis :
   les transforms sont sans effet sur un inline simple.) */
.ws-hf-text { display: inline-block; }
.ws-header .ws-hf-logo {
  height: ${s.headerLogoSize}mm;
  width: auto;
  transform: translateY(${s.headerLogoOffsetY}mm);
}
.ws-header .ws-hf-text {
  font-size: ${s.headerTextSize}pt;
  transform: translateY(${s.headerTextOffsetY}mm);
}
.ws-footer { color: #555; }
.ws-footer .ws-hf-text {
  font-size: ${s.footerTextSize}pt;
  transform: translateY(${s.footerTextOffsetY}mm);
}
.ws-footer .ws-pagenum { font-size: 9pt; font-variant-numeric: tabular-nums; white-space: nowrap; }
`
}
