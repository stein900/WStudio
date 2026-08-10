/** Types du module Éditeur PDF. */

/**
 * Fragment de texte détecté dans le PDF. Géométrie en unités PDF
 * (origine en bas à gauche de la page, y vers le haut) :
 * (x, y) est l'origine de la ligne de base, height la taille de police.
 */
export interface TextSpan {
  id: string
  pageIndex: number
  str: string
  x: number
  y: number
  width: number
  height: number
  /** Nom réel de la police d'origine (ex. « ABCDEE+Arial-BoldMT »), si connu. */
  fontName: string
}

/** Rectangle en unités PDF (origine en bas à gauche de la page). */
export interface PdfRect {
  x: number
  y: number
  width: number
  height: number
}

/** Modification d'un fragment : texte vide = effacement pur (blanc de masquage). */
export interface TextEdit {
  span: TextSpan
  text: string
  /** Couleur de fond échantillonnée autour du texte, pour un masquage discret. */
  bg: { r: number; g: number; b: number }
  /**
   * Zone à recouvrir, en unités PDF : l'encre réelle des glyphes détectée sur
   * le rendu (et non toute la boîte du fragment), pour ne pas effacer les
   * filets de tableaux ou le décor qui passent tout près du texte.
   */
  cover: PdfRect
  /**
   * Largeur disponible pour le nouveau texte (unités PDF) : jusqu'au fragment
   * suivant sur la même ligne, ou jusqu'au bord de la page. Un texte plus
   * long que l'original s'étire dans cet espace au lieu d'être rétréci ; il
   * n'est réduit que s'il déborderait sur le texte voisin.
   */
  maxWidth: number
}

/** Forme posée par-dessus le PDF (rectangle ou ellipse), en unités PDF. */
export interface ShapeAnnot {
  id: string
  pageIndex: number
  kind: 'rect' | 'ellipse'
  rect: PdfRect
  /** Couleur de contour (hex) — null : pas de contour. */
  stroke: string | null
  /** Couleur de remplissage (hex) — null : transparent. */
  fill: string | null
  strokeWidth: number
}

/** Image posée par-dessus le PDF, en unités PDF. */
export interface ImageAnnot {
  id: string
  pageIndex: number
  kind: 'image'
  rect: PdfRect
  /** Octets d'origine (PNG ou JPEG) embarqués tels quels à l'enregistrement. */
  bytes: ArrayBuffer
  mime: 'image/png' | 'image/jpeg'
  /** Aperçu à l'écran. */
  dataUrl: string
}

/** Texte libre posé par-dessus le PDF (multi-lignes), en unités PDF. */
export interface TextAnnot {
  id: string
  pageIndex: number
  kind: 'text'
  rect: PdfRect
  text: string
  /** Couleur (hex). */
  color: string
  /** Taille de police en unités PDF. */
  fontSize: number
}

export type Annot = ShapeAnnot | ImageAnnot | TextAnnot

/** Outil actif dans la vue. */
export type Tool = 'cursor' | 'rect' | 'ellipse' | 'text'

/** Boîte du fragment projetée à l'écran, en pixels CSS relatifs au canvas. */
export interface SpanRect {
  left: number
  top: number
  width: number
  height: number
  /** Taille de police à l'écran (px CSS) pour l'aperçu du texte modifié. */
  fontPx: number
}
