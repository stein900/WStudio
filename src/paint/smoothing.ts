/**
 * Lissage des tracés à main levée, en deux étages complémentaires :
 *
 *  1. PENDANT le tracé — un filtre exponentiel : chaque nouveau point est
 *     tiré vers le précédent, ce qui amortit le tremblement en temps réel
 *     sans latence perceptible ;
 *  2. AU LÂCHER — le tracé complet est nettoyé (points confondus), moyenné
 *     (moyenne glissante, extrémités préservées) puis simplifié
 *     (Ramer-Douglas-Peucker). Le rendu fait ensuite passer une courbe
 *     régulière par les points restants : le trait paraît dessiné d'une
 *     main sûre.
 *
 * `strength` est l'intensité 0..1 choisie par l'utilisateur (0 = brut).
 */

import type { Point } from './types'

/** Étage temps réel : tire `next` vers `prev` (plus fort = plus amorti). */
export function followPoint(prev: Point, next: Point, strength: number): Point {
  const follow = 1 - 0.55 * strength
  return {
    x: prev.x + (next.x - prev.x) * follow,
    y: prev.y + (next.y - prev.y) * follow,
  }
}

/** Retire les points quasi confondus (bruit d'échantillonnage du pointeur). */
function dedupe(points: Point[], minDist: number): Point[] {
  if (points.length < 2) return points
  const out = [points[0]]
  for (const p of points) {
    const last = out[out.length - 1]
    if (Math.hypot(p.x - last.x, p.y - last.y) >= minDist) out.push(p)
  }
  const tail = points[points.length - 1]
  const last = out[out.length - 1]
  if (tail !== last && (tail.x !== last.x || tail.y !== last.y)) out.push(tail)
  return out
}

/** Moyenne glissante à fenêtre 3, extrémités conservées, répétée `passes` fois. */
function movingAverage(points: Point[], passes: number): Point[] {
  let pts = points
  for (let pass = 0; pass < passes; pass++) {
    if (pts.length < 3) return pts
    const out = [pts[0]]
    for (let i = 1; i < pts.length - 1; i++) {
      out.push({
        x: (pts[i - 1].x + pts[i].x + pts[i + 1].x) / 3,
        y: (pts[i - 1].y + pts[i].y + pts[i + 1].y) / 3,
      })
    }
    out.push(pts[pts.length - 1])
    pts = out
  }
  return pts
}

/** Distance perpendiculaire de `p` à la droite (a, b). */
function perpDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y)
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len
}

/** Simplification Ramer-Douglas-Peucker (itérative : pile explicite). */
function rdp(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = keep[points.length - 1] = true
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()!
    let maxDist = 0
    let index = -1
    for (let i = first + 1; i < last; i++) {
      const d = perpDist(points[i], points[first], points[last])
      if (d > maxDist) {
        maxDist = d
        index = i
      }
    }
    if (index !== -1 && maxDist > epsilon) {
      keep[index] = true
      stack.push([first, index], [index, last])
    }
  }
  return points.filter((_, i) => keep[i])
}

/** Pipeline complet appliqué au lâcher du trait. */
export function smoothStroke(points: Point[], strength: number): Point[] {
  if (points.length < 3 || strength <= 0) return dedupe(points, 0.75)
  const passes = Math.round(1 + strength * 3)
  const averaged = movingAverage(dedupe(points, 1.25), passes)
  return rdp(averaged, 0.35 + strength * 1.4)
}
