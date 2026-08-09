/**
 * Modèle du module Paint — dessin vectoriel : le document est une pile de
 * calques et une liste de formes immuables (chacune rattachée à son calque),
 * redessinées intégralement à chaque changement. Aucune dépendance vers le
 * reste de l'application.
 */

export type Tool =
  | 'select'
  | 'pen'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'eraser'

export interface Point {
  x: number
  y: number
}

export interface ShapeStyle {
  stroke: string
  strokeWidth: number
  /** Aplat des formes fermées (rectangle, ellipse) ; null = contour seul. */
  fill: string | null
}

interface ShapeBase {
  id: string
  layerId: string
  style: ShapeStyle
}

/** Tracé à main levée (lissé au lâcher du trait). */
export interface PenShape extends ShapeBase {
  kind: 'pen'
  points: Point[]
}

export interface LineShape extends ShapeBase {
  kind: 'line' | 'arrow'
  from: Point
  to: Point
}

export interface BoxShape extends ShapeBase {
  kind: 'rect' | 'ellipse'
  from: Point
  to: Point
}

export interface TextShape extends ShapeBase {
  kind: 'text'
  /** Coin haut-gauche du bloc de texte. */
  pos: Point
  text: string
  fontSize: number
  /** Encombrement mesuré au moment de la saisie (mis à l'échelle ensuite). */
  w: number
  h: number
}

export type Shape = PenShape | LineShape | BoxShape | TextShape

export interface Layer {
  id: string
  name: string
  visible: boolean
}

/** Document complet : calques (premier = fond) + formes. */
export interface PaintDoc {
  layers: Layer[]
  shapes: Shape[]
}

export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

/** Poignées de la forme sélectionnée (8 sur les boîtes, extrémités des lignes). */
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'start' | 'end'
