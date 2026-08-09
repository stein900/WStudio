/**
 * Géométrie du module Paint : bornes, tests de survol, déplacement,
 * poignées de sélection et redimensionnement.
 */

import type { Bounds, HandleId, Point, Shape } from './types'

export function shapeBounds(s: Shape): Bounds {
  switch (s.kind) {
    case 'pen': {
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const p of s.points) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    }
    case 'text':
      return { x: s.pos.x, y: s.pos.y, w: s.w, h: s.h }
    default:
      return {
        x: Math.min(s.from.x, s.to.x),
        y: Math.min(s.from.y, s.to.y),
        w: Math.abs(s.to.x - s.from.x),
        h: Math.abs(s.to.y - s.from.y),
      }
  }
}

export function inflate(b: Bounds, m: number): Bounds {
  return { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m }
}

export function unionBounds(list: Bounds[]): Bounds {
  const x = Math.min(...list.map((b) => b.x))
  const y = Math.min(...list.map((b) => b.y))
  return {
    x,
    y,
    w: Math.max(...list.map((b) => b.x + b.w)) - x,
    h: Math.max(...list.map((b) => b.y + b.h)) - y,
  }
}

/** Distance de `p` au segment [a, b]. */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  const t = lenSq < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

export function pointInBounds(p: Point, b: Bounds, m: number): boolean {
  return p.x >= b.x - m && p.x <= b.x + b.w + m && p.y >= b.y - m && p.y <= b.y + b.h + m
}

/** Aligne `to` sur les angles à 45° autour de `from` (contrainte Maj). */
export function constrainTo45(from: Point, to: Point): Point {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
  const len = Math.hypot(dx, dy)
  return { x: from.x + len * Math.cos(angle), y: from.y + len * Math.sin(angle) }
}

/**
 * La forme est-elle sous le pointeur ? Traits et lignes : proximité du tracé.
 * Formes fermées : l'intérieur si remplies, sinon le contour seulement — on
 * peut ainsi attraper un objet posé DANS un cadre non rempli.
 */
export function hitTest(s: Shape, p: Point, tolerance: number): boolean {
  const t = tolerance + s.style.strokeWidth / 2
  switch (s.kind) {
    case 'pen': {
      if (s.points.length === 1)
        return Math.hypot(p.x - s.points[0].x, p.y - s.points[0].y) <= t
      for (let i = 0; i < s.points.length - 1; i++) {
        if (distToSegment(p, s.points[i], s.points[i + 1]) <= t) return true
      }
      return false
    }
    case 'line':
    case 'arrow':
      return distToSegment(p, s.from, s.to) <= t
    case 'text':
      return pointInBounds(p, shapeBounds(s), tolerance)
    case 'rect': {
      const b = shapeBounds(s)
      if (s.style.fill) return pointInBounds(p, b, t)
      return pointInBounds(p, b, t) && !pointInBounds(p, b, -t)
    }
    case 'ellipse': {
      const b = shapeBounds(s)
      const rx = Math.max(b.w / 2, 1e-6)
      const ry = Math.max(b.h / 2, 1e-6)
      const nx = (p.x - (b.x + rx)) / rx
      const ny = (p.y - (b.y + ry)) / ry
      const r = Math.hypot(nx, ny)
      if (s.style.fill) return r <= 1 + t / Math.min(rx, ry)
      return Math.abs(r - 1) * Math.min(rx, ry) <= t
    }
  }
}

export function translateShape(s: Shape, dx: number, dy: number): Shape {
  switch (s.kind) {
    case 'pen':
      return { ...s, points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
    case 'text':
      return { ...s, pos: { x: s.pos.x + dx, y: s.pos.y + dy } }
    default:
      return {
        ...s,
        from: { x: s.from.x + dx, y: s.from.y + dy },
        to: { x: s.to.x + dx, y: s.to.y + dy },
      }
  }
}

// ------------------------------------------------------------------
// Poignées de sélection et redimensionnement
// ------------------------------------------------------------------

export interface Handle {
  id: HandleId
  x: number
  y: number
  cursor: string
}

const BOX_HANDLES: { id: HandleId; fx: number; fy: number; cursor: string }[] = [
  { id: 'nw', fx: 0, fy: 0, cursor: 'nwse-resize' },
  { id: 'n', fx: 0.5, fy: 0, cursor: 'ns-resize' },
  { id: 'ne', fx: 1, fy: 0, cursor: 'nesw-resize' },
  { id: 'e', fx: 1, fy: 0.5, cursor: 'ew-resize' },
  { id: 'se', fx: 1, fy: 1, cursor: 'nwse-resize' },
  { id: 's', fx: 0.5, fy: 1, cursor: 'ns-resize' },
  { id: 'sw', fx: 0, fy: 1, cursor: 'nesw-resize' },
  { id: 'w', fx: 0, fy: 0.5, cursor: 'ew-resize' },
]

export function shapeHandles(s: Shape): Handle[] {
  if (s.kind === 'line' || s.kind === 'arrow') {
    return [
      { id: 'start', x: s.from.x, y: s.from.y, cursor: 'move' },
      { id: 'end', x: s.to.x, y: s.to.y, cursor: 'move' },
    ]
  }
  const b = shapeBounds(s)
  // le texte se redimensionne par les coins (échelle uniforme)
  const list =
    s.kind === 'text' ? BOX_HANDLES.filter((h) => h.id.length === 2) : BOX_HANDLES
  return list.map((h) => ({ id: h.id, x: b.x + b.w * h.fx, y: b.y + b.h * h.fy, cursor: h.cursor }))
}

export function handleAt(s: Shape, p: Point, tolerance = 7): Handle | null {
  return (
    shapeHandles(s).find(
      (h) => Math.abs(p.x - h.x) <= tolerance && Math.abs(p.y - h.y) <= tolerance
    ) ?? null
  )
}

/**
 * Redimensionne `orig` (état au DÉBUT du geste — jamais cumulatif, pour
 * éviter toute dérive) en amenant la poignée `handle` sous le pointeur.
 * Croiser une poignée retourne la forme, comme dans Paint.
 */
export function resizeShape(orig: Shape, handle: HandleId, p: Point, shiftKey: boolean): Shape {
  if (orig.kind === 'line' || orig.kind === 'arrow') {
    const anchor = handle === 'start' ? orig.to : orig.from
    const pt = shiftKey ? constrainTo45(anchor, p) : p
    return handle === 'start' ? { ...orig, from: pt } : { ...orig, to: pt }
  }

  const ob = shapeBounds(orig)
  let x1 = ob.x
  let y1 = ob.y
  let x2 = ob.x + ob.w
  let y2 = ob.y + ob.h
  if (handle.includes('w')) x1 = p.x
  if (handle.includes('e')) x2 = p.x
  if (handle.includes('n')) y1 = p.y
  if (handle.includes('s')) y2 = p.y

  if (orig.kind === 'text') {
    // échelle uniforme portée par la taille de police, coin opposé fixe
    const f = Math.max(
      ob.w > 1 ? Math.abs(x2 - x1) / ob.w : 1,
      ob.h > 1 ? Math.abs(y2 - y1) / ob.h : 1
    )
    const fontSize = Math.min(200, Math.max(8, orig.fontSize * f))
    const applied = fontSize / orig.fontSize
    const w = ob.w * applied
    const h = ob.h * applied
    return {
      ...orig,
      fontSize,
      w,
      h,
      pos: {
        x: handle.includes('w') ? ob.x + ob.w - w : ob.x,
        y: handle.includes('n') ? ob.y + ob.h - h : ob.y,
      },
    }
  }

  if (orig.kind === 'pen') {
    const sx = ob.w > 1e-6 ? (x2 - x1) / ob.w : 1
    const sy = ob.h > 1e-6 ? (y2 - y1) / ob.h : 1
    return {
      ...orig,
      points: orig.points.map((pt) => ({
        x: x1 + (pt.x - ob.x) * sx,
        y: y1 + (pt.y - ob.y) * sy,
      })),
    }
  }

  return { ...orig, from: { x: x1, y: y1 }, to: { x: x2, y: y2 } }
}
