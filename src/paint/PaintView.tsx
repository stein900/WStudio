/**
 * Paint — dessins & schémas. Vue plein écran autonome : outils de tracé
 * (crayon lissé, ligne, flèche, rectangle, ellipse), texte, calques,
 * sélection avec poignées (déplacement/redimensionnement façon Paint : la
 * forme reste active après son tracé, ancrée dès qu'on en commence une
 * autre), gomme d'objet, annuler/rétablir, export PNG. Le document est
 * conservé dans localStorage — on peut quitter et revenir sans rien perdre.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Icon, type IconName } from '../components/Icons'
import { createDoc, createLayer, isLayerVisible, parseDoc, visibleShapes, visibleShapesTopFirst } from './doc'
import {
  constrainTo45,
  handleAt,
  hitTest,
  pointInBounds,
  resizeShape,
  shapeBounds,
  translateShape,
} from './geometry'
import { measureTextSize, renderPngBlob, renderScene, withAlpha } from './render'
import { followPoint, smoothStroke } from './smoothing'
import type { HandleId, PaintDoc, Point, Shape, ShapeStyle, TextShape, Tool } from './types'
import './paint.css'

const LS_PAINT = 'wstudio.paint'
const HIT_TOLERANCE = 6
const HISTORY_MAX = 100

const PALETTE = ['#1d1d1f', '#6e6e73', '#0a84ff', '#30b350', '#ff9500', '#ff3b30', '#af52de']
const WIDTHS = [2, 3.5, 6]

const TOOLS: { id: Tool; icon: IconName; label: string; key: string }[] = [
  { id: 'select', icon: 'mouse-pointer', label: 'Sélectionner / déplacer', key: 'v' },
  { id: 'pen', icon: 'pencil', label: 'Crayon (lissage automatique)', key: 'p' },
  { id: 'line', icon: 'minus', label: 'Ligne', key: 'l' },
  { id: 'arrow', icon: 'arrow-up-right', label: 'Flèche', key: 'f' },
  { id: 'rect', icon: 'square', label: 'Rectangle', key: 'r' },
  { id: 'ellipse', icon: 'circle', label: 'Ellipse', key: 'e' },
  { id: 'text', icon: 'type', label: 'Texte (cliquer pour écrire)', key: 't' },
  { id: 'eraser', icon: 'eraser', label: 'Gomme (efface les objets du calque actif)', key: 'g' },
]

type Gesture =
  | { type: 'draw' }
  | { type: 'move'; before: PaintDoc; last: Point }
  | { type: 'resize'; before: PaintDoc; orig: Shape; handle: HandleId }
  | { type: 'erase'; before: PaintDoc }

/** Saisie de texte en cours (nouvelle si id null, sinon édition d'un bloc). */
interface TextEditing {
  id: string | null
  pos: Point
  value: string
  fontSize: number
  color: string
}

interface Props {
  onClose: () => void
}

/** Contrainte Maj pendant le tracé : 45° pour les lignes, carré pour les boîtes. */
function constrainDraw(kind: Shape['kind'], from: Point, to: Point): Point {
  if (kind === 'line' || kind === 'arrow') return constrainTo45(from, to)
  const dx = to.x - from.x
  const dy = to.y - from.y
  const side = Math.max(Math.abs(dx), Math.abs(dy))
  return { x: from.x + side * Math.sign(dx || 1), y: from.y + side * Math.sign(dy || 1) }
}

/** Taille de police d'un nouveau texte, liée à l'épaisseur choisie (S/M/L). */
function textSizeFor(strokeWidth: number): number {
  return Math.round(9 + strokeWidth * 2.6)
}

export function PaintView({ onClose }: Props) {
  const [doc, setDoc] = useState<PaintDoc>(() => parseDoc(localStorage.getItem(LS_PAINT)))
  const [tool, setTool] = useState<Tool>('pen')
  const [stroke, setStroke] = useState(PALETTE[0])
  const [strokeWidth, setStrokeWidth] = useState(WIDTHS[1])
  const [fillOn, setFillOn] = useState(false)
  const [smoothing, setSmoothing] = useState(0.6)
  const [grid, setGrid] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeLayerId, setActiveLayerId] = useState<string>(
    () => doc.layers[doc.layers.length - 1].id
  )
  const [editingText, setEditingText] = useState<TextEditing | null>(null)
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null)
  const [showLayers, setShowLayers] = useState(true)
  const [copied, setCopied] = useState(false)

  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  // Vrai tant que la forme sélectionnée vient d'être posée (pas encore ancrée) :
  // seul ce cas autorise le déplacement « à la Paint » en tirant l'intérieur du
  // cadre avec un outil de tracé. Sinon un grand objet sélectionné capturerait
  // tous les clics et rendrait le dessin impossible (bug constaté).
  const freshRef = useRef(false)

  // Le tracé en cours vit dans un ref (muté à chaque événement pointeur, sans
  // recopie) ; `tick` déclenche simplement le redessin.
  const draftRef = useRef<Shape | null>(null)
  const [tick, bumpTick] = useReducer((n: number) => n + 1, 0)
  const gestureRef = useRef<Gesture | null>(null)

  const docRef = useRef(doc)
  docRef.current = doc
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const smoothingRef = useRef(smoothing)
  smoothingRef.current = smoothing
  const editingTextRef = useRef(editingText)
  editingTextRef.current = editingText

  // Calque actif : repli sur le calque du dessus si l'actif a disparu (annulation…)
  const activeLayer =
    doc.layers.find((l) => l.id === activeLayerId) ?? doc.layers[doc.layers.length - 1]

  const selectedShape = (): Shape | undefined =>
    selectedIdRef.current
      ? docRef.current.shapes.find((s) => s.id === selectedIdRef.current)
      : undefined

  // ---------- Historique (annuler / rétablir) ----------
  const past = useRef<PaintDoc[]>([])
  const future = useRef<PaintDoc[]>([])
  const [, bumpHistory] = useReducer((n: number) => n + 1, 0)

  const recordHistory = useCallback((before: PaintDoc) => {
    past.current.push(before)
    if (past.current.length > HISTORY_MAX) past.current.shift()
    future.current = []
    bumpHistory()
  }, [])

  const commit = useCallback(
    (next: PaintDoc) => {
      recordHistory(docRef.current)
      setDoc(next)
    },
    [recordHistory]
  )

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(docRef.current)
    setDoc(prev)
    setSelectedId(null)
    freshRef.current = false
    bumpHistory()
  }, [])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(docRef.current)
    setDoc(next)
    setSelectedId(null)
    freshRef.current = false
    bumpHistory()
  }, [])

  /** Changer d'outil ancre la forme active : plus aucune sélection ne peut
   * bloquer le dessin (l'outil Sélection, lui, conserve la sélection). */
  const chooseTool = useCallback((t: Tool) => {
    setTool(t)
    freshRef.current = false
    if (t !== 'select') setSelectedId(null)
  }, [])

  const deleteSelected = useCallback(() => {
    const id = selectedIdRef.current
    if (!id) return
    const d = docRef.current
    commit({ ...d, shapes: d.shapes.filter((s) => s.id !== id) })
    setSelectedId(null)
    freshRef.current = false
  }, [commit])

  // ---------- Texte : ouverture et validation de la saisie ----------
  const startEditingText = (s: TextShape) => {
    setSelectedId(s.id)
    setActiveLayerId(s.layerId)
    setEditingText({
      id: s.id,
      pos: s.pos,
      value: s.text,
      fontSize: s.fontSize,
      color: s.style.stroke,
    })
  }

  /** Valide la saisie en cours (vide → rien / suppression du bloc édité). */
  const commitTextEditing = () => {
    const ed = editingTextRef.current
    if (!ed) return
    editingTextRef.current = null // le blur qui suit ne doit pas re-valider
    setEditingText(null)
    const text = ed.value.replace(/\s+$/, '')
    const d = docRef.current

    if (ed.id) {
      const existing = d.shapes.find((s) => s.id === ed.id)
      if (!existing || existing.kind !== 'text') return
      if (!text.trim()) {
        commit({ ...d, shapes: d.shapes.filter((s) => s.id !== ed.id) })
        setSelectedId(null)
      } else if (text !== existing.text) {
        const m = measureTextSize(text, existing.fontSize)
        commit({
          ...d,
          shapes: d.shapes.map((s) =>
            s.id === ed.id ? { ...existing, text, w: m.w, h: m.h } : s
          ),
        })
      }
      return
    }

    if (!text.trim()) return
    const m = measureTextSize(text, ed.fontSize)
    const shape: TextShape = {
      id: crypto.randomUUID(),
      kind: 'text',
      layerId: ensureDrawableLayer(),
      style: { stroke: ed.color, strokeWidth: 1, fill: null },
      pos: ed.pos,
      text,
      fontSize: ed.fontSize,
      w: m.w,
      h: m.h,
    }
    commit({ ...docRef.current, shapes: [...docRef.current.shapes, shape] })
    setSelectedId(shape.id)
  }

  /** Calque cible d'un nouvel objet — re-affiché s'il était masqué. */
  const ensureDrawableLayer = (): string => {
    const layer = activeLayer
    if (!layer.visible) {
      setDoc((d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === layer.id ? { ...l, visible: true } : l)),
      }))
    }
    return layer.id
  }

  // ---------- Toile : dimensionnement et redessin ----------
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const ro = new ResizeObserver(() => setSize({ w: stage.clientWidth, h: stage.clientHeight }))
    ro.observe(stage)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !size.w || !size.h) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.w * dpr)
    canvas.height = Math.round(size.h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    renderScene(ctx, size.w, size.h, doc, {
      draft: draftRef.current,
      selectedId,
      grid,
      hideShapeId: editingText?.id ?? null,
    })
  }, [doc, selectedId, grid, size, tick, editingText])

  // ---------- Gestes ----------
  const pointerPos = (e: React.PointerEvent): Point => ({
    x: e.nativeEvent.offsetX,
    y: e.nativeEvent.offsetY,
  })

  /** La gomme n'efface QUE le calque actif (et seulement s'il est visible). */
  const eraseAt = (p: Point) => {
    const layerId = activeLayer.id
    setDoc((d) => ({
      ...d,
      shapes: d.shapes.filter(
        (s) =>
          !(s.layerId === layerId && isLayerVisible(d, layerId) && hitTest(s, p, HIT_TOLERANCE))
      ),
    }))
  }

  /** La sélection est-elle attrapable ici (corps de la forme) ? Le corps est
   * le tracé lui-même (ou l'intérieur s'il est rempli) ; l'intérieur du cadre
   * complet ne déplace que la forme TOUT JUSTE posée, comme Paint — jamais
   * une sélection plus ancienne, qui volerait les clics du dessin. */
  const grabsSelection = (sel: Shape, p: Point): boolean =>
    hitTest(sel, p, HIT_TOLERANCE) ||
    (tool !== 'select' && freshRef.current && pointInBounds(p, shapeBounds(sel), 0))

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = pointerPos(e)

    // toucher la toile valide la saisie de texte en cours
    commitTextEditing()

    // forme active : poignées (redimensionner) puis corps (déplacer)
    const sel = selectedShape()
    if (sel && tool !== 'eraser' && isLayerVisible(docRef.current, sel.layerId)) {
      const handle = handleAt(sel, p)
      if (handle) {
        gestureRef.current = { type: 'resize', before: docRef.current, orig: sel, handle: handle.id }
        return
      }
      if (grabsSelection(sel, p)) {
        gestureRef.current = { type: 'move', before: docRef.current, last: p }
        return
      }
    }

    if (tool === 'select') {
      const hit = visibleShapesTopFirst(docRef.current).find((s) => hitTest(s, p, HIT_TOLERANCE))
      setSelectedId(hit?.id ?? null)
      freshRef.current = false
      if (hit) {
        setActiveLayerId(hit.layerId)
        gestureRef.current = { type: 'move', before: docRef.current, last: p }
      }
      return
    }
    if (tool === 'eraser') {
      gestureRef.current = { type: 'erase', before: docRef.current }
      eraseAt(p)
      return
    }
    if (tool === 'text') {
      setSelectedId(null)
      const hitText = visibleShapesTopFirst(docRef.current).find(
        (s): s is TextShape => s.kind === 'text' && hitTest(s, p, HIT_TOLERANCE)
      )
      if (hitText) startEditingText(hitText)
      else
        setEditingText({
          id: null,
          pos: p,
          value: '',
          fontSize: textSizeFor(strokeWidth),
          color: stroke,
        })
      return
    }

    // outils de tracé : la forme précédente s'ancre, une nouvelle commence
    setSelectedId(null)
    const style: ShapeStyle = {
      stroke,
      strokeWidth,
      fill: fillOn && (tool === 'rect' || tool === 'ellipse') ? withAlpha(stroke, 0.14) : null,
    }
    const layerId = ensureDrawableLayer()
    draftRef.current =
      tool === 'pen'
        ? { id: crypto.randomUUID(), kind: 'pen', layerId, style, points: [p] }
        : { id: crypto.randomUUID(), kind: tool, layerId, style, from: p, to: p }
    gestureRef.current = { type: 'draw' }
    bumpTick()
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gestureRef.current
    const p = pointerPos(e)

    if (!g) {
      // survol : curseur adapté (poignées, corps déplaçable, outil courant)
      const canvas = canvasRef.current
      if (!canvas) return
      let cursor = tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair'
      const sel = selectedShape()
      if (sel && tool !== 'eraser' && isLayerVisible(docRef.current, sel.layerId)) {
        const handle = handleAt(sel, p)
        if (handle) cursor = handle.cursor
        else if (grabsSelection(sel, p)) cursor = 'move'
      }
      canvas.style.cursor = cursor
      return
    }

    if (g.type === 'draw') {
      const d = draftRef.current
      if (!d) return
      if (d.kind === 'pen') {
        // étage temps réel du lissage : le point est tiré vers le précédent
        const last = d.points[d.points.length - 1]
        d.points.push(followPoint(last, p, smoothingRef.current))
      } else if (d.kind !== 'text') {
        d.to = e.shiftKey ? constrainDraw(d.kind, d.from, p) : p
      }
      bumpTick()
    } else if (g.type === 'move') {
      const dx = p.x - g.last.x
      const dy = p.y - g.last.y
      g.last = p
      const id = selectedIdRef.current
      if (id && (dx || dy))
        setDoc((d) => ({
          ...d,
          shapes: d.shapes.map((s) => (s.id === id ? translateShape(s, dx, dy) : s)),
        }))
    } else if (g.type === 'resize') {
      const id = selectedIdRef.current
      if (id)
        setDoc((d) => ({
          ...d,
          shapes: d.shapes.map((s) =>
            s.id === id ? resizeShape(g.orig, g.handle, p, e.shiftKey) : s
          ),
        }))
    } else {
      eraseAt(p)
    }
  }

  const onPointerUp = () => {
    const g = gestureRef.current
    gestureRef.current = null
    if (!g) return

    if (g.type === 'draw') {
      const d = draftRef.current
      draftRef.current = null
      if (!d) return
      if (d.kind === 'pen') {
        // étage final du lissage : moyenne glissante + simplification
        const points = smoothStroke(d.points, smoothingRef.current)
        commit({ ...docRef.current, shapes: [...docRef.current.shapes, { ...d, points }] })
      } else if (d.kind !== 'text') {
        const w = Math.abs(d.to.x - d.from.x)
        const h = Math.abs(d.to.y - d.from.y)
        if (w >= 3 || h >= 3) {
          commit({ ...docRef.current, shapes: [...docRef.current.shapes, d] })
          setSelectedId(d.id) // la forme reste active : poignées prêtes
          freshRef.current = true // déplaçable par tout son cadre jusqu'à l'ancrage
        } else {
          bumpTick() // tracé avorté : effacer le brouillon affiché
        }
      }
      return
    }
    // déplacement / redimensionnement / gommage : une entrée d'historique par geste
    if (docRef.current !== g.before) recordHistory(g.before)
  }

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== 'select') return
    const p: Point = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }
    const hitText = visibleShapesTopFirst(docRef.current).find(
      (s): s is TextShape => s.kind === 'text' && hitTest(s, p, HIT_TOLERANCE)
    )
    if (hitText) startEditingText(hitText)
  }

  // ---------- Clavier ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const key = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if ((e.ctrlKey || e.metaKey) && key === 'y') {
        e.preventDefault()
        redo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected()
      } else if (e.key === 'Escape') {
        // ancre la forme active / abandonne le tracé en cours
        draftRef.current = null
        gestureRef.current = null
        setSelectedId(null)
        freshRef.current = false
        bumpTick()
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = TOOLS.find((tl) => tl.key === key)
        if (t) chooseTool(t.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, deleteSelected, chooseTool])

  // ---------- Sauvegarde locale du document ----------
  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem(LS_PAINT, JSON.stringify(doc)), 400)
    return () => clearTimeout(t)
  }, [doc])

  // ---------- Calques ----------
  const addLayer = () => {
    const layer = createLayer(`Calque ${doc.layers.length + 1}`)
    commit({ ...doc, layers: [...doc.layers, layer] })
    setActiveLayerId(layer.id)
  }

  const removeLayer = (id: string) => {
    if (doc.layers.length <= 1) return
    const count = doc.shapes.filter((s) => s.layerId === id).length
    if (count > 0 && !window.confirm(`Supprimer le calque et ses ${count} objet(s) ?`)) return
    const layers = doc.layers.filter((l) => l.id !== id)
    commit({ layers, shapes: doc.shapes.filter((s) => s.layerId !== id) })
    if (activeLayerId === id) setActiveLayerId(layers[layers.length - 1].id)
    const sel = selectedShape()
    if (sel?.layerId === id) setSelectedId(null)
  }

  const moveLayer = (id: string, dir: 1 | -1) => {
    const i = doc.layers.findIndex((l) => l.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= doc.layers.length) return
    const layers = [...doc.layers]
    ;[layers[i], layers[j]] = [layers[j], layers[i]]
    commit({ ...doc, layers })
  }

  // visibilité et renommage : hors historique (pas des gestes de dessin)
  const toggleLayerVisible = (id: string) => {
    setDoc((d) => ({
      ...d,
      layers: d.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    }))
  }

  const renameLayer = (id: string, name: string) => {
    setRenamingLayerId(null)
    const clean = name.trim()
    if (!clean) return
    setDoc((d) => ({
      ...d,
      layers: d.layers.map((l) => (l.id === id ? { ...l, name: clean } : l)),
    }))
  }

  // ---------- Export ----------
  const savePng = useCallback(async () => {
    const blob = await renderPngBlob(docRef.current)
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'schema.png'
    a.click()
    URL.revokeObjectURL(a.href)
  }, [])

  const copyPng = useCallback(async () => {
    const blob = await renderPngBlob(docRef.current)
    if (!blob) return
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* presse-papiers indisponible : le bouton Export reste utilisable */
    }
  }, [])

  const clearAll = useCallback(() => {
    if (!docRef.current.shapes.length) return
    if (!window.confirm('Effacer tout le dessin (tous les calques) ?')) return
    commit(createDoc())
    setSelectedId(null)
  }, [commit])

  const exportable = visibleShapes(doc).length > 0

  return (
    <div className="paint">
      <header className="topbar">
        <button className="btn" onClick={onClose} title="Retour à l'accueil">
          <Icon name="home" />
          Accueil
        </button>
        <span className="topbar-divider" />
        <span className="paint-title">
          <Icon name="pencil" size={15} />
          Paint
          <span className="paint-title-sub">dessins &amp; schémas</span>
        </span>
        <span className="topbar-divider" />

        <div className="topbar-group" role="toolbar" aria-label="Outils">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`tb-btn ${tool === t.id ? 'is-active' : ''}`}
              onClick={() => chooseTool(t.id)}
              title={`${t.label} (${t.key.toUpperCase()})`}
            >
              <Icon name={t.icon} size={15} />
            </button>
          ))}
        </div>
        <span className="topbar-divider" />

        <div className="topbar-group" aria-label="Couleur">
          {PALETTE.map((c) => (
            <button
              key={c}
              className={`paint-swatch ${stroke === c ? 'is-active' : ''}`}
              style={{ background: c }}
              onClick={() => setStroke(c)}
              title={c}
            />
          ))}
          <input
            type="color"
            className="paint-swatch paint-swatch-custom"
            value={stroke}
            onChange={(e) => setStroke(e.target.value)}
            title="Couleur personnalisée"
          />
        </div>
        <span className="topbar-divider" />

        <div className="topbar-group" aria-label="Épaisseur">
          {WIDTHS.map((w) => (
            <button
              key={w}
              className={`tb-btn ${strokeWidth === w ? 'is-active' : ''}`}
              onClick={() => setStrokeWidth(w)}
              title={`Épaisseur ${w} px (fixe aussi la taille des nouveaux textes)`}
            >
              <span className="paint-width-dot" style={{ width: w + 3, height: w + 3 }} />
            </button>
          ))}
          <button
            className={`tb-btn ${fillOn ? 'is-active' : ''}`}
            onClick={() => setFillOn((f) => !f)}
            title="Remplir les rectangles et ellipses (aplat translucide)"
          >
            <span
              className="paint-fill-dot"
              style={{ background: fillOn ? withAlpha(stroke, 0.35) : 'transparent' }}
            />
          </button>
        </div>
        <span className="topbar-divider" />

        <label
          className="paint-slider"
          title="Lissage automatique du crayon : amortit le tremblement de la main pendant le tracé, puis régularise le trait au lâcher"
        >
          <Icon name="sparkles" size={13} />
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(smoothing * 100)}
            onChange={(e) => setSmoothing(Number(e.target.value) / 100)}
          />
        </label>

        <div className="topbar-group topbar-right">
          <button
            className={`tb-btn ${grid ? 'is-active' : ''}`}
            onClick={() => setGrid((v) => !v)}
            title="Grille de points (repère visuel, absente de l'export)"
          >
            <Icon name="grid" size={15} />
          </button>
          <button
            className={`tb-btn ${showLayers ? 'is-active' : ''}`}
            onClick={() => setShowLayers((v) => !v)}
            title="Panneau des calques"
          >
            <Icon name="layers" size={15} />
          </button>
          <span className="topbar-divider" />
          <button
            className="tb-btn"
            onClick={undo}
            disabled={past.current.length === 0}
            title="Annuler (Ctrl+Z)"
          >
            <Icon name="undo" size={15} />
          </button>
          <button
            className="tb-btn"
            onClick={redo}
            disabled={future.current.length === 0}
            title="Rétablir (Ctrl+Maj+Z)"
          >
            <Icon name="redo" size={15} />
          </button>
          <button
            className="tb-btn"
            onClick={clearAll}
            disabled={doc.shapes.length === 0}
            title="Tout effacer"
          >
            <Icon name="trash" size={15} />
          </button>
          <span className="topbar-divider" />
          <button
            className="btn"
            onClick={() => void copyPng()}
            disabled={!exportable}
            title="Copier le dessin (image PNG des calques visibles) dans le presse-papiers"
          >
            <Icon name={copied ? 'check' : 'copy'} />
            {copied ? 'Copié' : 'Copier'}
          </button>
          <button
            className="btn-primary"
            onClick={() => void savePng()}
            disabled={!exportable}
            title="Enregistrer les calques visibles en PNG (cadré, fond blanc)"
          >
            <Icon name="download" />
            Export PNG
          </button>
        </div>
      </header>

      <div className="paint-stage" ref={stageRef}>
        <canvas
          ref={canvasRef}
          className="paint-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
        />

        {editingText && (
          <textarea
            className="paint-text-editor"
            style={{
              left: editingText.pos.x - 4,
              top: editingText.pos.y - 3,
              color: editingText.color,
              fontSize: editingText.fontSize,
              width: measureTextSize(editingText.value || 'M', editingText.fontSize).w +
                editingText.fontSize + 8,
              height: measureTextSize(editingText.value || 'M', editingText.fontSize).h + 8,
            }}
            value={editingText.value}
            autoFocus
            spellCheck={false}
            placeholder="Texte…"
            onChange={(e) => setEditingText({ ...editingText, value: e.target.value })}
            onBlur={commitTextEditing}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                commitTextEditing()
              }
            }}
          />
        )}

        {showLayers && (
          <aside className="paint-layers">
            <div className="paint-layers-head">
              <span>
                <Icon name="layers" size={14} />
                Calques
              </span>
              <button className="tb-btn" onClick={addLayer} title="Nouveau calque (au premier plan)">
                <Icon name="plus" size={14} />
              </button>
            </div>
            <ul>
              {[...doc.layers].reverse().map((layer, ri) => {
                const count = doc.shapes.filter((s) => s.layerId === layer.id).length
                const isTop = ri === 0
                const isBottom = ri === doc.layers.length - 1
                return (
                  <li
                    key={layer.id}
                    className={`paint-layer ${layer.id === activeLayer.id ? 'is-active' : ''} ${
                      layer.visible ? '' : 'is-hidden'
                    }`}
                    onClick={() => setActiveLayerId(layer.id)}
                  >
                    <button
                      className="tb-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleLayerVisible(layer.id)
                      }}
                      title={layer.visible ? 'Masquer le calque' : 'Afficher le calque'}
                    >
                      <Icon name={layer.visible ? 'eye' : 'eye-off'} size={13} />
                    </button>
                    {renamingLayerId === layer.id ? (
                      <input
                        autoFocus
                        defaultValue={layer.name}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => renameLayer(layer.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') renameLayer(layer.id, e.currentTarget.value)
                          if (e.key === 'Escape') setRenamingLayerId(null)
                        }}
                      />
                    ) : (
                      <span
                        className="paint-layer-name"
                        onDoubleClick={() => setRenamingLayerId(layer.id)}
                        title="Double-clic pour renommer"
                      >
                        {layer.name}
                      </span>
                    )}
                    <span className="paint-layer-count">{count || ''}</span>
                    <span className="paint-layer-tools">
                      <button
                        className="tb-btn"
                        disabled={isTop}
                        onClick={(e) => {
                          e.stopPropagation()
                          moveLayer(layer.id, 1)
                        }}
                        title="Monter (vers le premier plan)"
                      >
                        <Icon name="chevron-up" size={13} />
                      </button>
                      <button
                        className="tb-btn"
                        disabled={isBottom}
                        onClick={(e) => {
                          e.stopPropagation()
                          moveLayer(layer.id, -1)
                        }}
                        title="Descendre (vers le fond)"
                      >
                        <Icon name="chevron-down" size={13} />
                      </button>
                      <button
                        className="tb-btn"
                        disabled={doc.layers.length <= 1}
                        onClick={(e) => {
                          e.stopPropagation()
                          removeLayer(layer.id)
                        }}
                        title="Supprimer le calque"
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </span>
                  </li>
                )
              })}
            </ul>
            <p className="paint-layers-hint">
              Le dessin va sur le calque actif ; sélectionner un objet active son calque.
            </p>
          </aside>
        )}
      </div>

      <footer className="statusbar">
        <span>
          {doc.shapes.length} objet{doc.shapes.length > 1 ? 's' : ''} ·{' '}
          {doc.layers.length} calque{doc.layers.length > 1 ? 's' : ''}
        </span>
        <span className="status-hint">
          Une forme posée reste active (poignées) et s'ancre au tracé suivant ou avec
          Échap · la gomme n'agit que sur le calque actif · Maj = régulier · double-clic
          = éditer un texte
        </span>
        <span>
          calque : {activeLayer.name} · lissage {Math.round(smoothing * 100)} %
        </span>
      </footer>
    </div>
  )
}
