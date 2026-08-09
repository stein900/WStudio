/**
 * Rendu canvas du module Paint. La toile est un papier blanc dans les deux
 * thèmes (comme les pages du reste de l'application) ; les tracés à main
 * levée sont dessinés en courbes quadratiques par points milieux — c'est ce
 * qui donne leur galbe régulier aux points issus du lissage.
 */

import { isLayerVisible, visibleShapes } from './doc'
import { inflate, shapeBounds, shapeHandles, unionBounds } from './geometry'
import type { PaintDoc, Point, Shape, TextShape } from './types'

const PAPER = '#ffffff'
const GRID_COLOR = '#dcdce1'
const GRID_STEP = 24
const SELECTION_COLOR = '#0a84ff'

/** Réglages du texte — partagés entre le rendu et la zone de saisie (CSS). */
export const TEXT_LINE_HEIGHT = 1.3
export function textFont(fontSize: number): string {
  return `500 ${fontSize}px Inter, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif`
}

let measurer: CanvasRenderingContext2D | null = null

/** Encombrement d'un bloc de texte (multiligne). */
export function measureTextSize(text: string, fontSize: number): { w: number; h: number } {
  if (!measurer) measurer = document.createElement('canvas').getContext('2d')
  if (!measurer) return { w: 4, h: fontSize * TEXT_LINE_HEIGHT }
  measurer.font = textFont(fontSize)
  const lines = text.split('\n')
  let w = 4
  for (const line of lines) w = Math.max(w, measurer.measureText(line).width)
  return { w, h: Math.max(1, lines.length) * fontSize * TEXT_LINE_HEIGHT }
}

/** Aplat translucide dérivé de la couleur de trait (formes remplies). */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/** Courbe régulière passant par les points (quadratiques par points milieux). */
function tracePath(ctx: CanvasRenderingContext2D, pts: Point[]): void {
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y)
    return
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = (pts[i].x + pts[i + 1].x) / 2
    const midY = (pts[i].y + pts[i + 1].y) / 2
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY)
  }
  const last = pts[pts.length - 1]
  ctx.lineTo(last.x, last.y)
}

function drawText(ctx: CanvasRenderingContext2D, s: TextShape): void {
  ctx.font = textFont(s.fontSize)
  ctx.textBaseline = 'top'
  ctx.fillStyle = s.style.stroke
  const lineHeight = s.fontSize * TEXT_LINE_HEIGHT
  const halfLeading = (TEXT_LINE_HEIGHT - 1) * s.fontSize * 0.5
  s.text.split('\n').forEach((line, i) => {
    ctx.fillText(line, s.pos.x, s.pos.y + halfLeading + i * lineHeight)
  })
}

export function drawShape(ctx: CanvasRenderingContext2D, s: Shape): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = s.style.stroke
  ctx.fillStyle = s.style.stroke
  ctx.lineWidth = s.style.strokeWidth

  switch (s.kind) {
    case 'pen': {
      if (s.points.length === 1) {
        // clic sans mouvement : une pastille
        ctx.beginPath()
        ctx.arc(s.points[0].x, s.points[0].y, s.style.strokeWidth / 2 + 0.5, 0, Math.PI * 2)
        ctx.fill()
      } else {
        tracePath(ctx, s.points)
        ctx.stroke()
      }
      break
    }
    case 'line': {
      ctx.beginPath()
      ctx.moveTo(s.from.x, s.from.y)
      ctx.lineTo(s.to.x, s.to.y)
      ctx.stroke()
      break
    }
    case 'arrow': {
      const angle = Math.atan2(s.to.y - s.from.y, s.to.x - s.from.x)
      const head = 8 + 2.6 * s.style.strokeWidth
      // fût raccourci pour ne pas dépasser de la pointe
      ctx.beginPath()
      ctx.moveTo(s.from.x, s.from.y)
      ctx.lineTo(s.to.x - head * 0.6 * Math.cos(angle), s.to.y - head * 0.6 * Math.sin(angle))
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(s.to.x, s.to.y)
      ctx.lineTo(s.to.x - head * Math.cos(angle - 0.42), s.to.y - head * Math.sin(angle - 0.42))
      ctx.lineTo(s.to.x - head * Math.cos(angle + 0.42), s.to.y - head * Math.sin(angle + 0.42))
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'rect': {
      const b = shapeBounds(s)
      roundedRect(ctx, b.x, b.y, b.w, b.h, 6)
      if (s.style.fill) {
        ctx.fillStyle = s.style.fill
        ctx.fill()
      }
      ctx.stroke()
      break
    }
    case 'ellipse': {
      const b = shapeBounds(s)
      ctx.beginPath()
      ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2)
      if (s.style.fill) {
        ctx.fillStyle = s.style.fill
        ctx.fill()
      }
      ctx.stroke()
      break
    }
    case 'text': {
      drawText(ctx, s)
      break
    }
  }
  ctx.restore()
}

/** Contour de sélection + poignées de déplacement/redimensionnement. */
function drawSelection(ctx: CanvasRenderingContext2D, s: Shape): void {
  ctx.save()
  ctx.strokeStyle = SELECTION_COLOR
  ctx.lineWidth = 1.5
  if (s.kind !== 'line' && s.kind !== 'arrow') {
    const b = shapeBounds(s)
    ctx.setLineDash([5, 4])
    roundedRect(ctx, b.x, b.y, b.w, b.h, 2)
    ctx.stroke()
  }
  ctx.setLineDash([])
  for (const h of shapeHandles(s)) {
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.rect(h.x - 3.5, h.y - 3.5, 7, 7)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

export interface SceneOptions {
  draft: Shape | null
  selectedId: string | null
  grid: boolean
  /** Forme masquée pendant sa saisie (texte en cours d'édition). */
  hideShapeId: string | null
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  doc: PaintDoc,
  opts: SceneOptions
): void {
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, width, height)

  if (opts.grid) {
    ctx.fillStyle = GRID_COLOR
    for (let x = GRID_STEP; x < width; x += GRID_STEP) {
      for (let y = GRID_STEP; y < height; y += GRID_STEP) {
        ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5)
      }
    }
  }

  for (const s of visibleShapes(doc)) {
    if (s.id !== opts.hideShapeId) drawShape(ctx, s)
  }
  if (opts.draft) drawShape(ctx, opts.draft)

  const selected = opts.selectedId
    ? doc.shapes.find((s) => s.id === opts.selectedId)
    : undefined
  if (selected && selected.id !== opts.hideShapeId && isLayerVisible(doc, selected.layerId))
    drawSelection(ctx, selected)
}

/** Export PNG (2×) des calques visibles, cadré sur le dessin, marge blanche. */
export async function renderPngBlob(doc: PaintDoc): Promise<Blob | null> {
  const shapes = visibleShapes(doc)
  if (!shapes.length) return null
  const b = inflate(unionBounds(shapes.map(shapeBounds)), 24)
  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(b.w * scale))
  canvas.height = Math.max(1, Math.round(b.h * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(scale, scale)
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, b.w, b.h)
  ctx.translate(-b.x, -b.y)
  for (const s of shapes) drawShape(ctx, s)
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}
