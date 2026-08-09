/** Document Paint : création, relecture (avec migration) et parcours. */

import type { Layer, PaintDoc, Shape } from './types'

export function createLayer(name: string): Layer {
  return { id: crypto.randomUUID(), name, visible: true }
}

export function createDoc(): PaintDoc {
  return { layers: [createLayer('Calque 1')], shapes: [] }
}

/**
 * Relit un document sauvegardé. Migre l'ancien format (simple tableau de
 * formes, sans calques) vers un document à un calque.
 */
export function parseDoc(raw: string | null): PaintDoc {
  if (!raw) return createDoc()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      const doc = createDoc()
      doc.shapes = (parsed as Shape[]).map((s) => ({ ...s, layerId: doc.layers[0].id }))
      return doc
    }
    const doc = parsed as PaintDoc
    if (Array.isArray(doc.layers) && Array.isArray(doc.shapes) && doc.layers.length > 0)
      return doc
  } catch {
    /* document sauvegardé illisible : toile vierge */
  }
  return createDoc()
}

export function isLayerVisible(doc: PaintDoc, layerId: string): boolean {
  return doc.layers.find((l) => l.id === layerId)?.visible ?? false
}

/** Formes visibles dans l'ordre de rendu (fond → premier plan). */
export function visibleShapes(doc: PaintDoc): Shape[] {
  const out: Shape[] = []
  for (const layer of doc.layers) {
    if (!layer.visible) continue
    for (const s of doc.shapes) if (s.layerId === layer.id) out.push(s)
  }
  return out
}

/** Formes visibles du premier plan vers le fond (tests de survol). */
export function visibleShapesTopFirst(doc: PaintDoc): Shape[] {
  return visibleShapes(doc).reverse()
}
