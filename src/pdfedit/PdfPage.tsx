/**
 * Une page du PDF dans la vue continue : canvas rendu par pdf.js, calque de
 * fragments de texte cliquables (saisie inline), et calque d'annotations —
 * formes et images posées par-dessus, dessinées à la souris, déplaçables et
 * redimensionnables. Le rendu n'a lieu que lorsque la page approche de la
 * fenêtre (prop `visible`).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist'
import { Icon } from '../components/Icons'
import { extractSpans, inkCoverRect, pdfRectToCss, renderPage, sampleBackground, spanRect, textAnnotSize } from './pdf'
import type { Annot, PdfRect, ShapeAnnot, SpanRect, TextEdit, TextSpan, Tool } from './types'

/** Style CSS approchant la police d'origine, pour l'aperçu des textes modifiés. */
function previewFontStyle(fontName: string): {
  fontFamily: string
  fontWeight: number
  fontStyle: 'normal' | 'italic'
} {
  const n = fontName.toLowerCase()
  let fontFamily = 'Helvetica, Arial, sans-serif'
  if (/courier|mono|consolas/.test(n)) fontFamily = '"Courier New", monospace'
  else if (/times|georgia|garamond|book|serif|roman|cambria/.test(n) && !/sans/.test(n))
    fontFamily = '"Times New Roman", serif'
  return {
    fontFamily,
    fontWeight: /bold|black|heavy|semibold|demi/.test(n) ? 700 : 400,
    fontStyle: /italic|oblique/.test(n) ? 'italic' : 'normal',
  }
}

/** Taille de police (px) réduite seulement si le texte déborde de l'espace libre. */
const measureCtx = document.createElement('canvas').getContext('2d')
function fitFontPx(text: string, rect: SpanRect, fontName: string, maxWidthPx: number): number {
  let px = rect.fontPx
  if (!measureCtx || !text) return px
  const st = previewFontStyle(fontName)
  measureCtx.font = `${st.fontStyle} ${st.fontWeight} ${px}px ${st.fontFamily}`
  const w = measureCtx.measureText(text).width
  const maxW = Math.max(maxWidthPx, rect.width)
  if (w > maxW && w > 0) px = (px * maxW) / w
  return px
}


function rgbCss(c: { r: number; g: number; b: number }): string {
  return `rgb(${c.r}, ${c.g}, ${c.b})`
}

/** Boîte écran (px CSS) → rectangle en unités PDF. */
function cssRectToPdf(
  left: number,
  top: number,
  width: number,
  height: number,
  viewport: PageViewport
): PdfRect {
  const p1 = viewport.convertToPdfPoint(left, top)
  const p2 = viewport.convertToPdfPoint(left + width, top + height)
  return {
    x: Math.min(p1[0], p2[0]),
    y: Math.min(p1[1], p2[1]),
    width: Math.abs(p2[0] - p1[0]),
    height: Math.abs(p2[1] - p1[1]),
  }
}

interface Editing {
  span: TextSpan
  rect: SpanRect
  value: string
}

/** Saisie d'un texte libre (nouveau si id null, sinon édition d'un existant). */
interface TextEditing {
  id: string | null
  /** Coin haut-gauche à l'écran (px CSS relatifs au canvas). */
  cssX: number
  cssY: number
  value: string
  color: string
  fontSize: number
}

type HandleId = 'nw' | 'ne' | 'sw' | 'se'

/** Geste en cours sur le calque d'annotations. */
type Gesture =
  | { type: 'draw'; x0: number; y0: number; x1: number; y1: number }
  | { type: 'move'; id: string; startX: number; startY: number; orig: PdfRect }
  | { type: 'resize'; id: string; handle: HandleId; startX: number; startY: number; orig: PdfRect }

interface Props {
  doc: PDFDocumentProxy
  pageIndex: number
  scale: number
  /** Dimensions de la page à l'échelle 1 (placeholder avant rendu). */
  baseSize: { width: number; height: number }
  visible: boolean
  tool: Tool
  shapeStyle: { stroke: string | null; fill: string | null; strokeWidth: number }
  textStyle: { color: string; fontSize: number }
  edits: Map<string, TextEdit>
  annots: Annot[]
  selectedAnnot: string | null
  onEdit: (edit: TextEdit) => void
  onClearEdit: (spanId: string) => void
  onAddAnnot: (annot: Annot) => void
  onMoveAnnot: (id: string, rect: PdfRect) => void
  onSelectAnnot: (id: string | null) => void
  onRenderError: () => void
}

export function PdfPage({
  doc,
  pageIndex,
  scale,
  baseSize,
  visible,
  tool,
  shapeStyle,
  textStyle,
  edits,
  annots,
  selectedAnnot,
  onEdit,
  onClearEdit,
  onAddAnnot,
  onMoveAnnot,
  onSelectAnnot,
  onRenderError,
}: Props) {
  const [spans, setSpans] = useState<TextSpan[]>([])
  const [rects, setRects] = useState<Map<string, SpanRect>>(new Map())
  const [viewport, setViewport] = useState<PageViewport | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [textEditing, setTextEditing] = useState<TextEditing | null>(null)
  const [gesture, setGesture] = useState<Gesture | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const renderSeqRef = useRef(0)
  const renderChainRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    if (!visible) return
    const seq = ++renderSeqRef.current
    // Chaîne de rendu : pdf.js refuse deux rendus simultanés sur un canvas
    renderChainRef.current = renderChainRef.current.then(async () => {
      if (seq !== renderSeqRef.current) return
      try {
        const page = await doc.getPage(pageIndex + 1)
        const vp = page.getViewport({ scale })
        const canvas = canvasRef.current
        if (!canvas || seq !== renderSeqRef.current) return
        await renderPage(page, canvas, vp)
        if (seq !== renderSeqRef.current) return
        const pageSpans = await extractSpans(page, pageIndex)
        if (seq !== renderSeqRef.current) return
        setViewport(vp)
        setSpans(pageSpans)
        setRects(new Map(pageSpans.map((s) => [s.id, spanRect(s, vp)])))
      } catch {
        onRenderError()
      }
    })
  }, [doc, pageIndex, scale, visible, onRenderError])

  // Page repartie loin de la fenêtre : libérer le canvas (des dizaines de
  // pages rendues satureraient la mémoire) — elle sera re-rendue au retour.
  useEffect(() => {
    if (visible || !viewport) return
    const canvas = canvasRef.current
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
      canvas.style.width = ''
      canvas.style.height = ''
    }
    setViewport(null)
    setSpans([])
    setRects(new Map())
    setEditing(null)
    setTextEditing(null)
  }, [visible, viewport])

  // ---------- Édition du texte ----------
  const beginEdit = useCallback(
    (span: TextSpan) => {
      if (tool !== 'cursor') return
      const rect = rects.get(span.id)
      if (!rect) return
      const existing = edits.get(span.id)
      setEditing({ span, rect, value: existing ? existing.text : span.str })
    },
    [tool, rects, edits]
  )

  // Tout sélectionner à l'OUVERTURE de la saisie seulement — surtout pas à
  // chaque frappe (editing change à chaque lettre, pas editingId).
  const editingId = editing?.span.id ?? null
  useEffect(() => {
    if (editingId) inputRef.current?.select()
  }, [editingId])

  const commitEdit = useCallback(() => {
    const ed = editing
    if (!ed) return
    setEditing(null)
    if (ed.value === ed.span.str) {
      onClearEdit(ed.span.id) // texte identique à l'original : plus de modif
      return
    }
    const canvas = canvasRef.current
    const bg = canvas ? sampleBackground(canvas, ed.rect) : { r: 255, g: 255, b: 255 }
    const cover =
      canvas && viewport
        ? inkCoverRect(ed.span, ed.rect, canvas, viewport, bg)
        : {
            x: ed.span.x,
            y: ed.span.y - ed.span.height * 0.26,
            width: ed.span.width,
            height: ed.span.height * 1.1,
          }
    // Espace d'étirement : jusqu'au fragment suivant sur la même ligne
    // (protège le texte voisin), sinon jusqu'au bord droit de la page.
    const s = ed.span
    const rightNeighbors = spans.filter(
      (o) =>
        o.id !== s.id &&
        Math.abs(o.y - s.y) < Math.max(o.height, s.height) * 0.6 &&
        o.x > s.x + s.width * 0.5
    )
    const rightLimit = rightNeighbors.length
      ? Math.min(...rightNeighbors.map((o) => o.x)) - 3
      : baseSize.width - 16
    const maxWidth = Math.max(s.width, rightLimit - s.x)
    onEdit({ span: s, text: ed.value, bg, cover, maxWidth })
  }, [editing, viewport, spans, baseSize.width, onEdit, onClearEdit])

  // ---------- Texte libre : pose et édition ----------
  const textEditingOpen = textEditing !== null
  useEffect(() => {
    if (textEditingOpen) textAreaRef.current?.focus()
  }, [textEditingOpen])

  const beginTextAnnotEdit = useCallback(
    (a: Annot) => {
      if (a.kind !== 'text' || !viewport) return
      const r = pdfRectToCss(a.rect, viewport)
      setTextEditing({
        id: a.id,
        cssX: r.left,
        cssY: r.top,
        value: a.text,
        color: a.color,
        fontSize: a.fontSize,
      })
    },
    [viewport]
  )

  // Prend la saisie en paramètre : le blur d'une saisie qui se ferme ne doit
  // pas écraser celle qu'un clic vient d'ouvrir ailleurs.
  const commitTextEdit = useCallback((te: TextEditing) => {
    if (!viewport) return
    setTextEditing((cur) => (cur === te ? null : cur))
    const value = te.value.replace(/\s+$/, '')
    if (!value.trim()) return // vide : rien à créer (l'existant reste intact)
    const size = textAnnotSize(value, te.fontSize)
    const p = viewport.convertToPdfPoint(te.cssX, te.cssY)
    const existing = te.id ? annots.find((a) => a.id === te.id) : null
    const top = existing ? existing.rect.y + existing.rect.height : p[1]
    const x = existing ? existing.rect.x : p[0]
    onAddAnnot({
      id: te.id ?? crypto.randomUUID(),
      pageIndex,
      kind: 'text',
      rect: { x, y: top - size.height, width: size.width, height: size.height },
      text: value,
      color: te.color,
      fontSize: te.fontSize,
    })
  }, [viewport, annots, pageIndex, onAddAnnot])

  // ---------- Annotations : dessin, déplacement, redimensionnement ----------
  const localPoint = (e: React.PointerEvent): { x: number; y: number } => {
    const el = canvasRef.current
    const r = el ? el.getBoundingClientRect() : { left: 0, top: 0 }
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const startDraw = useCallback(
    (e: React.PointerEvent) => {
      if (tool === 'cursor' || e.button !== 0) return
      const p = localPoint(e)
      if (tool === 'text') {
        // Sans preventDefault, l'action par défaut du mousedown (déplacement
        // du focus vers la surface cliquée) s'exécute APRÈS l'ouverture de la
        // saisie et la refermerait aussitôt par blur.
        e.preventDefault()
        // Une saisie était en cours : cliquer ailleurs la VALIDE (le
        // preventDefault ci-dessus court-circuite son blur), puis on ouvre
        // la nouvelle à l'endroit cliqué.
        if (textEditing && textEditing.value.trim()) commitTextEdit(textEditing)
        setTextEditing({
          id: null,
          cssX: p.x,
          cssY: p.y,
          value: '',
          color: textStyle.color,
          fontSize: textStyle.fontSize,
        })
        return
      }
      ;(e.target as Element).setPointerCapture(e.pointerId)
      setGesture({ type: 'draw', x0: p.x, y0: p.y, x1: p.x, y1: p.y })
    },
    [tool, textStyle, textEditing, commitTextEdit]
  )

  const startMove = useCallback(
    (e: React.PointerEvent, annot: Annot) => {
      if (tool !== 'cursor' || e.button !== 0) return
      e.stopPropagation()
      onSelectAnnot(annot.id)
      const p = localPoint(e)
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      setGesture({ type: 'move', id: annot.id, startX: p.x, startY: p.y, orig: annot.rect })
    },
    [tool, onSelectAnnot]
  )

  const startResize = useCallback(
    (e: React.PointerEvent, annot: Annot, handle: HandleId) => {
      if (e.button !== 0) return
      e.stopPropagation()
      const p = localPoint(e)
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      setGesture({ type: 'resize', id: annot.id, handle, startX: p.x, startY: p.y, orig: annot.rect })
    },
    []
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!gesture || !viewport) return
      const p = localPoint(e)
      if (gesture.type === 'draw') {
        setGesture({ ...gesture, x1: p.x, y1: p.y })
        return
      }
      // Déplacements en unités PDF (dy inversé : l'axe y du PDF monte)
      const scaleInv = 1 / viewport.scale
      const dx = (p.x - gesture.startX) * scaleInv
      const dy = -(p.y - gesture.startY) * scaleInv
      const o = gesture.orig
      if (gesture.type === 'move') {
        onMoveAnnot(gesture.id, { ...o, x: o.x + dx, y: o.y + dy })
        return
      }
      // Redimensionnement : la poignée déplace son coin, l'opposé est fixe
      let x1 = o.x
      let y1 = o.y
      let x2 = o.x + o.width
      let y2 = o.y + o.height
      const h = gesture.handle
      if (h === 'nw' || h === 'sw') x1 += dx
      else x2 += dx
      if (h === 'sw' || h === 'se') y1 += dy
      else y2 += dy
      const min = 4 * scaleInv
      onMoveAnnot(gesture.id, {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.max(min, Math.abs(x2 - x1)),
        height: Math.max(min, Math.abs(y2 - y1)),
      })
    },
    [gesture, viewport, onMoveAnnot]
  )

  const onPointerUp = useCallback(() => {
    const g = gesture
    setGesture(null)
    if (!g || g.type !== 'draw' || !viewport) return
    const w = Math.abs(g.x1 - g.x0)
    const h = Math.abs(g.y1 - g.y0)
    if (w < 6 || h < 6) return // simple clic : rien à créer
    const annot: ShapeAnnot = {
      id: crypto.randomUUID(),
      pageIndex,
      kind: tool === 'ellipse' ? 'ellipse' : 'rect',
      rect: cssRectToPdf(Math.min(g.x0, g.x1), Math.min(g.y0, g.y1), w, h, viewport),
      stroke: shapeStyle.stroke ?? (shapeStyle.fill ? null : '#ff3b30'),
      fill: shapeStyle.fill,
      strokeWidth: shapeStyle.strokeWidth,
    }
    onAddAnnot(annot)
  }, [gesture, viewport, pageIndex, tool, shapeStyle, onAddAnnot])

  const rendered = viewport !== null
  const w = rendered ? viewport.width : baseSize.width * scale
  const h = rendered ? viewport.height : baseSize.height * scale

  return (
    <div className="pdfedit-page" style={{ width: w, height: h }} data-page={pageIndex}>
      <canvas ref={canvasRef} className="pdfedit-canvas" />
      {!rendered && <div className="pdfedit-page-num">{pageIndex + 1}</div>}
      {rendered && (
        <div
          className="pdfedit-overlay"
          onPointerDown={(e) => {
            // Clic dans le vide (pas sur une annotation) : désélectionne
            if (tool === 'cursor' && e.target === e.currentTarget) onSelectAnnot(null)
          }}
        >
          {tool === 'cursor' &&
            spans.map((span) => {
              const rect = rects.get(span.id)
              if (!rect) return null
              const edit = edits.get(span.id)
              const beingEdited = editing?.span.id === span.id
              if (!edit || beingEdited) {
                return (
                  <div
                    key={span.id}
                    className="pdfedit-span"
                    style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
                    title="Cliquer pour modifier ce texte"
                    onClick={() => beginEdit(span)}
                  />
                )
              }
              // Fragment modifié : cache l'encre d'origine (zone détectée
              // uniquement — les filets de tableau restent visibles), puis
              // affiche le nouveau texte par-dessus.
              const st = previewFontStyle(span.fontName)
              const cover = viewport ? pdfRectToCss(edit.cover, viewport) : rect
              return (
                <div
                  key={span.id}
                  className="pdfedit-span is-edited"
                  style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
                  title={`Texte modifié — cliquer pour rééditer\nOriginal : ${span.str}`}
                  onClick={() => beginEdit(span)}
                >
                  <span
                    className="pdfedit-cover"
                    style={{
                      left: cover.left - rect.left,
                      top: cover.top - rect.top,
                      width: cover.width,
                      height: cover.height,
                      background: rgbCss(edit.bg),
                    }}
                  />
                  <span
                    className="pdfedit-newtext"
                    style={{
                      fontSize: fitFontPx(
                        edit.text,
                        rect,
                        span.fontName,
                        (edit.maxWidth || 0) * (viewport?.scale ?? 1)
                      ),
                      fontFamily: st.fontFamily,
                      fontWeight: st.fontWeight,
                      fontStyle: st.fontStyle,
                    }}
                  >
                    {edit.text}
                  </span>
                </div>
              )
            })}

          {/* Annotations posées par-dessus (toujours visibles) */}
          {viewport &&
            annots.map((a) => {
              const r = pdfRectToCss(a.rect, viewport)
              const selected = a.id === selectedAnnot
              const strokePx =
                a.kind === 'rect' || a.kind === 'ellipse'
                  ? Math.max(1, a.strokeWidth * viewport.scale)
                  : 0
              return (
                <div
                  key={a.id}
                  className={`pdfedit-annot${selected ? ' is-selected' : ''}`}
                  style={{
                    left: r.left,
                    top: r.top,
                    width: r.width,
                    height: r.height,
                    pointerEvents: tool === 'cursor' ? 'auto' : 'none',
                    cursor: tool === 'cursor' ? 'move' : undefined,
                  }}
                  onPointerDown={(e) => startMove(e, a)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onDoubleClick={() => beginTextAnnotEdit(a)}
                >
                  {a.kind === 'image' ? (
                    <img src={a.dataUrl} alt="" draggable={false} />
                  ) : a.kind === 'text' ? (
                    textEditing?.id === a.id ? null : (
                      <div
                        className="pdfedit-textcontent"
                        style={{ fontSize: a.fontSize * viewport.scale, color: a.color }}
                        title="Double-cliquer pour modifier le texte"
                      >
                        {a.text}
                      </div>
                    )
                  ) : (
                    <div
                      className="pdfedit-shape"
                      style={{
                        border: a.stroke ? `${strokePx}px solid ${a.stroke}` : 'none',
                        background: a.fill ?? 'transparent',
                        borderRadius: a.kind === 'ellipse' ? '50%' : 0,
                      }}
                    />
                  )}
                  {selected &&
                    a.kind !== 'text' &&
                    (['nw', 'ne', 'sw', 'se'] as HandleId[]).map((hid) => (
                      <span
                        key={hid}
                        className={`pdfedit-handle pdfedit-handle-${hid}`}
                        onPointerDown={(e) => startResize(e, a, hid)}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                      />
                    ))}
                </div>
              )
            })}

          {/* Surface de dessin des formes (outil rectangle/ellipse actif) */}
          {tool !== 'cursor' && (
            <div
              className="pdfedit-draw"
              onPointerDown={startDraw}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              {gesture?.type === 'draw' && (
                <div
                  className="pdfedit-shape pdfedit-draft"
                  style={{
                    left: Math.min(gesture.x0, gesture.x1),
                    top: Math.min(gesture.y0, gesture.y1),
                    width: Math.abs(gesture.x1 - gesture.x0),
                    height: Math.abs(gesture.y1 - gesture.y0),
                    border: `${Math.max(1, shapeStyle.strokeWidth * (viewport?.scale ?? 1))}px solid ${
                      shapeStyle.stroke ?? '#ff3b30'
                    }`,
                    background: shapeStyle.fill ?? 'transparent',
                    borderRadius: tool === 'ellipse' ? '50%' : 0,
                  }}
                />
              )}
            </div>
          )}

          {textEditing && viewport && (
            <div
              className="pdfedit-textbox"
              style={{ left: textEditing.cssX - 3, top: textEditing.cssY - 3 }}
            >
              <div
                className="pdfedit-textbar"
                /* preventDefault : le clic sur ces boutons ne doit pas faire
                   perdre le focus au textarea (sinon son blur validerait
                   avant même que « Annuler » ne s'exécute) */
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
              >
                <button
                  className="pdfedit-textbtn is-ok"
                  onClick={() => commitTextEdit(textEditing)}
                  title="Valider le texte (cliquer ailleurs valide aussi)"
                >
                  <Icon name="check" size={12} />
                  Valider
                </button>
                <button
                  className="pdfedit-textbtn"
                  onClick={() => setTextEditing(null)}
                  title="Annuler (Échap)"
                >
                  <Icon name="x" size={12} />
                  Annuler
                </button>
              </div>
              <textarea
                ref={textAreaRef}
                className="pdfedit-textinput"
                style={{
                  width: Math.max(
                    200,
                    textAnnotSize(textEditing.value || 'M', textEditing.fontSize).width *
                      viewport.scale +
                      28
                  ),
                  height:
                    textEditing.value.split('\n').length *
                      textEditing.fontSize *
                      1.25 *
                      viewport.scale +
                    12,
                  fontSize: textEditing.fontSize * viewport.scale,
                  color: textEditing.color,
                }}
                value={textEditing.value}
                onChange={(e) =>
                  setTextEditing((te) => (te ? { ...te, value: e.target.value } : te))
                }
                onPointerDown={(e) => e.stopPropagation()}
                onBlur={() => commitTextEdit(textEditing)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setTextEditing(null)
                  }
                }}
                placeholder="Votre texte…"
                spellCheck={false}
              />
            </div>
          )}
          {editing && (
            <input
              ref={inputRef}
              className="pdfedit-input"
              style={{
                left: editing.rect.left - 3,
                top: editing.rect.top - 3,
                width: Math.max(editing.rect.width + 60, 180),
                height: editing.rect.height + 6,
                fontSize: editing.rect.fontPx,
              }}
              value={editing.value}
              onChange={(e) => setEditing((ed) => (ed ? { ...ed, value: e.target.value } : ed))}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit()
                else if (e.key === 'Escape') setEditing(null)
              }}
              spellCheck={false}
            />
          )}
        </div>
      )}
    </div>
  )
}
