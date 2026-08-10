/**
 * Couche pdf.js : chargement du document, rendu des pages sur canvas et
 * extraction des fragments de texte avec leur géométrie (pour les rendre
 * cliquables et pouvoir les recouvrir à l'enregistrement).
 */

import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PdfRect, SpanRect, TextSpan } from './types'

GlobalWorkerOptions.workerSrc = workerUrl

/** Item de getTextContent() (type minimal — pdf.js ne l'exporte pas proprement). */
interface RawTextItem {
  str: string
  transform: number[]
  width: number
  height: number
  fontName: string
}

// Ressources pdf.js (polices standard, CMaps CJK, décodeurs wasm) copiées
// dans public/pdfjs/ — indispensables aux PDF dont les polices ne sont pas
// embarquées. En dev, Vite les sert en HTTP ; en production Electron la page
// est en file:// (fetch impossible) : le protocole interne wstudio:// les sert.
const RESOURCES =
  window.location.protocol === 'file:'
    ? 'wstudio://pdfjs/'
    : new URL('pdfjs/', document.baseURI).href

export async function loadPdf(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  // pdf.js transfère le buffer au worker : on lui passe une copie pour
  // garder l'original intact (il resservira à l'enregistrement pdf-lib).
  return getDocument({
    data: bytes.slice(0),
    standardFontDataUrl: `${RESOURCES}standard_fonts/`,
    cMapUrl: `${RESOURCES}cmaps/`,
    cMapPacked: true,
    wasmUrl: `${RESOURCES}wasm/`,
    iccUrl: `${RESOURCES}iccs/`,
  }).promise
}

/** Rend la page dans le canvas (netteté écran : tient compte du devicePixelRatio). */
export async function renderPage(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  viewport: PageViewport
): Promise<void> {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.floor(viewport.width * dpr)
  canvas.height = Math.floor(viewport.height * dpr)
  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`
  await page.render({
    canvas,
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
  }).promise
}

/** Marges verticales du rectangle englobant, en fraction de la taille de police. */
export const ASCENT = 0.84
export const DESCENT = 0.26

/**
 * Fragments de texte éditables de la page. Seuls les textes horizontaux non
 * vides sont retenus : le texte incliné ou vertical est rare dans les
 * rapports et son recouvrement serait hasardeux.
 */
export async function extractSpans(page: PDFPageProxy, pageIndex: number): Promise<TextSpan[]> {
  const content = await page.getTextContent()
  const spans: TextSpan[] = []
  let i = 0
  for (const raw of content.items as RawTextItem[]) {
    i++
    if (!raw.str || !raw.str.trim() || !raw.transform) continue
    const [a, b, c, d, e, f] = raw.transform
    // Horizontal (ni rotation ni cisaillement notables) et taille exploitable
    if (Math.hypot(b, c) > 0.02 * Math.hypot(a, d)) continue
    const height = raw.height || Math.abs(d)
    if (height <= 0 || raw.width <= 0) continue
    spans.push({
      id: `${pageIndex}:${i}`,
      pageIndex,
      str: raw.str,
      x: e,
      y: f,
      width: raw.width,
      height,
      fontName: realFontName(page, raw.fontName),
    })
  }
  return spans
}

/** Nom réel de la police (disponible une fois la page rendue), sinon ''. */
function realFontName(page: PDFPageProxy, internalName: string): string {
  try {
    const font = page.commonObjs.get(internalName) as { name?: string } | null
    return font?.name ?? ''
  } catch {
    return ''
  }
}

/** Boîte écran d'un fragment (px CSS relatifs au canvas, origine en haut à gauche). */
export function spanRect(span: TextSpan, viewport: PageViewport): SpanRect {
  const p1 = viewport.convertToViewportPoint(span.x, span.y - span.height * DESCENT)
  const p2 = viewport.convertToViewportPoint(span.x + span.width, span.y + span.height * ASCENT)
  const left = Math.min(p1[0], p2[0])
  const top = Math.min(p1[1], p2[1])
  return {
    left,
    top,
    width: Math.abs(p2[0] - p1[0]),
    height: Math.abs(p2[1] - p1[1]),
    fontPx: span.height * viewport.scale,
  }
}

/**
 * Couleur de fond autour d'un fragment, échantillonnée sur le canvas rendu.
 * Couleur la plus fréquente (mode) parmi des pixels pris sur les quatre
 * côtés de la boîte : un filet de tableau qui longe un des côtés ne pollue
 * qu'une fraction des échantillons et ne peut pas l'emporter sur le vrai
 * fond. Blanc en cas d'échec.
 */
export function sampleBackground(
  canvas: HTMLCanvasElement,
  rect: SpanRect
): { r: number; g: number; b: number } {
  const white = { r: 255, g: 255, b: 255 }
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return white
  const dpr = canvas.width / Math.max(1, canvas.clientWidth || canvas.width)
  const pts: [number, number][] = []
  const N = 8
  for (let k = 0; k <= N; k++) {
    const x = rect.left + (rect.width * k) / N
    const y = rect.top + (rect.height * k) / N
    pts.push([x, rect.top - 2], [x, rect.top + rect.height + 2]) // au-dessus / au-dessous
    pts.push([rect.left - 2, y], [rect.left + rect.width + 2, y]) // à gauche / à droite
  }
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (const [xCss, yCss] of pts) {
    const x = Math.round(xCss * dpr)
    const y = Math.round(yCss * dpr)
    if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) continue
    try {
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data
      // Quantifié sur 32 niveaux : les nuances d'anticrénelage se regroupent
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
      const c = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
      c.n++
      c.r += r
      c.g += g
      c.b += b
      counts.set(key, c)
    } catch {
      return white
    }
  }
  let best: { n: number; r: number; g: number; b: number } | null = null
  for (const c of counts.values()) if (!best || c.n > best.n) best = c
  if (!best) return white
  return {
    r: Math.round(best.r / best.n),
    g: Math.round(best.g / best.n),
    b: Math.round(best.b / best.n),
  }
}

/** Boîte (unités PDF) d'un texte libre à une taille donnée — aperçu et export. */
const textMeasureCtx = document.createElement('canvas').getContext('2d')
export function textAnnotSize(text: string, fontSize: number): { width: number; height: number } {
  const lines = text.split('\n')
  let w = fontSize * 0.6
  if (textMeasureCtx) {
    textMeasureCtx.font = `${fontSize}px Helvetica, Arial, sans-serif`
    for (const l of lines) w = Math.max(w, textMeasureCtx.measureText(l).width)
  }
  return { width: w + 2, height: lines.length * fontSize * 1.25 }
}

/** Boîte de recouvrement par défaut (toute la hauteur du fragment). */
export function defaultCover(span: TextSpan): PdfRect {
  const pad = Math.max(0.6, span.height * 0.06)
  return {
    x: span.x - pad,
    y: span.y - span.height * DESCENT,
    width: span.width + pad * 2,
    height: span.height * (ASCENT + DESCENT),
  }
}

/** Rectangle PDF → boîte écran (px CSS relatifs au canvas de la page). */
export function pdfRectToCss(
  rect: PdfRect,
  viewport: PageViewport
): { left: number; top: number; width: number; height: number } {
  const p1 = viewport.convertToViewportPoint(rect.x, rect.y)
  const p2 = viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height)
  return {
    left: Math.min(p1[0], p2[0]),
    top: Math.min(p1[1], p2[1]),
    width: Math.abs(p2[0] - p1[0]),
    height: Math.abs(p2[1] - p1[1]),
  }
}

/**
 * Zone à recouvrir pour un fragment : le rectangle englobant des pixels
 * d'encre des glyphes, détecté sur le canvas rendu. Les filets qui traversent
 * la boîte de part en part (bordure de cellule sous la ligne de texte, trait
 * vertical de colonne…) sont reconnus — rangée ou colonne encrée quasi
 * continue — et exclus : recouvrir un « A » dans un tableau n'effacera plus
 * la bordure de la cellule. Repli sur la boîte complète si la détection
 * échoue (texte invisible, canvas inaccessible).
 */
export function inkCoverRect(
  span: TextSpan,
  rect: SpanRect,
  canvas: HTMLCanvasElement,
  viewport: PageViewport,
  bg: { r: number; g: number; b: number }
): PdfRect {
  const fallback = defaultCover(span)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return fallback
  const dpr = canvas.width / Math.max(1, canvas.clientWidth || canvas.width)
  const x0 = Math.max(0, Math.floor(rect.left * dpr))
  const y0 = Math.max(0, Math.floor(rect.top * dpr))
  const w = Math.min(canvas.width - x0, Math.ceil(rect.width * dpr))
  const h = Math.min(canvas.height - y0, Math.ceil(rect.height * dpr))
  if (w < 2 || h < 2) return fallback

  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(x0, y0, w, h).data
  } catch {
    return fallback
  }

  // Carte d'encre : pixel notablement différent de la couleur de fond
  const ink = new Uint8Array(w * h)
  const rowN = new Uint32Array(h)
  const colN = new Uint32Array(w)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const d = Math.max(
        Math.abs(data[i] - bg.r),
        Math.abs(data[i + 1] - bg.g),
        Math.abs(data[i + 2] - bg.b)
      )
      if (d > 45) {
        ink[y * w + x] = 1
        rowN[y]++
        colN[x]++
      }
    }
  }

  // Filets traversants : rangées/colonnes encrées sur ≥ 90 % de la boîte
  // (les glyphes, eux, laissent des vides). Ignorés dans le calcul.
  const lineRow = (y: number) => rowN[y] >= w * 0.9
  const lineCol = (x: number) => colN[x] >= h * 0.9
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    if (lineRow(y)) continue
    for (let x = 0; x < w; x++) {
      if (!ink[y * w + x] || lineCol(x)) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return fallback

  // Marge d'un pixel écran pour l'anticrénelage, puis retour en unités PDF
  const m = Math.max(1, dpr)
  const cssL = (x0 + minX - m) / dpr
  const cssT = (y0 + minY - m) / dpr
  const cssR = (x0 + maxX + 1 + m) / dpr
  const cssB = (y0 + maxY + 1 + m) / dpr
  const p1 = viewport.convertToPdfPoint(cssL, cssT)
  const p2 = viewport.convertToPdfPoint(cssR, cssB)
  return {
    x: Math.min(p1[0], p2[0]),
    y: Math.min(p1[1], p2[1]),
    width: Math.abs(p2[0] - p1[0]),
    height: Math.abs(p2[1] - p1[1]),
  }
}
