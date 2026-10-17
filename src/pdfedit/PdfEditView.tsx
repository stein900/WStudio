/**
 * Éditeur PDF — module autonome plein écran : on importe un PDF, toutes les
 * pages s'affichent à la suite (rendu paresseux au fil du défilement), chaque
 * texte est cliquable et remplaçable, et on peut poser par-dessus des formes
 * (rectangle, ellipse — contour, remplissage, épaisseur) et des images, puis
 * exporter le PDF modifié. Le fichier d'origine n'est jamais touché :
 * l'enregistrement produit une copie « -modifié.pdf ».
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Icon, type IconName } from '../components/Icons'
import { loadPdf, textAnnotSize } from './pdf'
import { PdfPage } from './PdfPage'
import { saveEditedPdf } from './save'
import type { Annot, ImageAnnot, PdfRect, TextEdit, Tool } from './types'
import './pdfedit.css'

interface Props {
  onClose: () => void
  /** PDF fourni par « Ouvrir avec » de Windows : chargé dès le montage. */
  initialFile?: { name: string; bytes: ArrayBuffer } | null
}

const ZOOMS = [0.5, 0.65, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5]

/** Palette commune avec Paint. */
const PALETTE = ['#1d1d1f', '#6e6e73', '#0a84ff', '#30b350', '#ff9500', '#ff3b30', '#af52de']
const WIDTHS = [1.5, 2.5, 4.5]

const TOOLS: { id: Tool; icon: IconName; label: string }[] = [
  { id: 'cursor', icon: 'mouse-pointer', label: 'Sélectionner — modifier le texte, déplacer les ajouts' },
  { id: 'rect', icon: 'square', label: 'Rectangle (glisser pour tracer)' },
  { id: 'ellipse', icon: 'circle', label: 'Ellipse / rond (glisser pour tracer)' },
  { id: 'text', icon: 'type', label: 'Texte (cliquer sur la page pour écrire, double-clic pour rééditer)' },
]

const TEXT_SIZES = [10, 12, 14, 18, 24, 32]

/**
 * Charge une image utilisateur. L'image est TOUJOURS décodée puis ré-encodée
 * via canvas — jamais embarquée telle quelle : les JPEG progressifs ou CMYK,
 * les PNG 16 bits ou entrelacés et l'orientation EXIF des photos passent mal
 * dans certaines visionneuses une fois insérés bruts dans un PDF, alors que
 * l'aperçu navigateur les affiche sans broncher. Le ré-encodage produit un
 * PNG 8 bits (transparence conservée) ou un JPEG baseline, identiques
 * partout, avec l'orientation EXIF appliquée.
 */
async function loadImageFile(f: File): Promise<Omit<ImageAnnot, 'id' | 'pageIndex' | 'rect'> & {
  width: number
  height: number
} | null> {
  try {
    const bmp = await createImageBitmap(f) // décode + applique l'orientation EXIF
    const c = document.createElement('canvas')
    c.width = bmp.width
    c.height = bmp.height
    const g = c.getContext('2d')
    if (!g) return null
    g.drawImage(bmp, 0, 0)
    const mime = f.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, mime, 0.92))
    if (!blob) return null
    const bytes = await blob.arrayBuffer()
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(r.result as string)
      r.onerror = rej
      r.readAsDataURL(blob)
    })
    return { kind: 'image', bytes, mime, dataUrl, width: bmp.width, height: bmp.height }
  } catch {
    return null
  }
}

export function PdfEditView({ onClose, initialFile }: Props) {
  const [file, setFile] = useState<{ name: string; bytes: ArrayBuffer } | null>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [baseSizes, setBaseSizes] = useState<{ width: number; height: number }[]>([])
  const [scale, setScale] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [currentPage, setCurrentPage] = useState(0)
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set())
  const [edits, setEdits] = useState<Map<string, TextEdit>>(new Map())
  const [annots, setAnnots] = useState<Map<string, Annot>>(new Map())
  const [selectedAnnot, setSelectedAnnot] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('cursor')
  const [stroke, setStroke] = useState<string | null>('#ff3b30')
  const [fill, setFill] = useState<string | null>(null)
  const [strokeWidth, setStrokeWidth] = useState(2.5)
  const [textColor, setTextColor] = useState('#1d1d1f')
  const [textSize, setTextSize] = useState(14)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stageRef = useRef<HTMLDivElement>(null)
  const openInputRef = useRef<HTMLInputElement>(null)
  const imgInputRef = useRef<HTMLInputElement>(null)
  const slotsRef = useRef(new Map<number, HTMLDivElement>())

  const numPages = baseSizes.length
  const totalChanges = edits.size + annots.size

  // ---------- Ouverture ----------
  const openBytes = useCallback(async (name: string, bytes: ArrayBuffer) => {
    setLoading(true)
    setError(null)
    try {
      const pdf = await loadPdf(bytes)
      const sizes: { width: number; height: number }[] = []
      for (let i = 1; i <= pdf.numPages; i++) {
        const vp = (await pdf.getPage(i)).getViewport({ scale: 1 })
        sizes.push({ width: vp.width, height: vp.height })
      }
      slotsRef.current.clear()
      setFile({ name, bytes })
      setDoc(pdf)
      setBaseSizes(sizes)
      setZoom(1)
      setCurrentPage(0)
      setVisiblePages(new Set([0]))
      setEdits(new Map())
      setAnnots(new Map())
      setSelectedAnnot(null)
      setTool('cursor')
      stageRef.current?.scrollTo({ top: 0 })
    } catch {
      setError('Impossible d’ouvrir ce fichier : est-ce bien un PDF valide (non protégé) ?')
    } finally {
      setLoading(false)
    }
  }, [])

  const openFile = useCallback(
    async (f: File) => {
      try {
        await openBytes(f.name, await f.arrayBuffer())
      } catch {
        setError('Impossible d’ouvrir ce fichier : est-ce bien un PDF valide (non protégé) ?')
      }
    },
    [openBytes]
  )

  // Fichier « Ouvrir avec » : chargé à l'ouverture du module (le composant
  // est remonté — via key — pour chaque nouveau fichier externe).
  useEffect(() => {
    if (initialFile) void openBytes(initialFile.name, initialFile.bytes)
  }, [initialFile, openBytes])

  const onFilePicked = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]
      if (f) void openFile(f)
      e.target.value = ''
    },
    [openFile]
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const f = e.dataTransfer.files?.[0]
      if (f && /\.pdf$/i.test(f.name)) void openFile(f)
    },
    [openFile]
  )

  // ---------- Échelle : largeur de page ajustée à la fenêtre × zoom ----------
  useEffect(() => {
    if (!baseSizes.length) return
    const stageW = stageRef.current?.clientWidth ?? 900
    const maxW = Math.max(...baseSizes.map((s) => s.width))
    const fit = Math.min(2.4, Math.max(0.3, (stageW - 96) / maxW))
    setScale(fit * zoom)
  }, [baseSizes, zoom])

  // ---------- Rendu paresseux : pages proches de la fenêtre ----------
  useEffect(() => {
    if (!doc || !numPages) return
    const stage = stageRef.current
    if (!stage) return
    const io = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          let changed = false
          const next = new Set(prev)
          for (const e of entries) {
            const idx = Number((e.target as HTMLElement).dataset.slot)
            if (Number.isNaN(idx)) continue
            if (e.isIntersecting && !next.has(idx)) {
              next.add(idx)
              changed = true
            } else if (!e.isIntersecting && next.has(idx)) {
              next.delete(idx) // loin de la fenêtre : la page libérera son canvas
              changed = true
            }
          }
          return changed ? next : prev
        })
      },
      { root: stage, rootMargin: '1200px 0px' }
    )
    for (const el of slotsRef.current.values()) io.observe(el)
    return () => io.disconnect()
  }, [doc, numPages])

  // ---------- Page courante (indicateur) suivant le défilement ----------
  const onScroll = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    const midline = stage.scrollTop + stage.clientHeight * 0.4
    let best = 0
    let bestDist = Infinity
    for (const [idx, el] of slotsRef.current) {
      const center = el.offsetTop + el.offsetHeight / 2
      const dist =
        midline >= el.offsetTop && midline <= el.offsetTop + el.offsetHeight
          ? 0
          : Math.abs(center - midline)
      if (dist < bestDist) {
        bestDist = dist
        best = idx
      }
    }
    setCurrentPage(best)
  }, [])

  const gotoPage = useCallback((index: number) => {
    const el = slotsRef.current.get(index)
    if (!el) return
    stageRef.current?.scrollTo({ top: el.offsetTop - 16, behavior: 'smooth' })
    setCurrentPage(index)
  }, [])

  // ---------- Modifications du texte ----------
  const onEdit = useCallback((edit: TextEdit) => {
    setEdits((prev) => new Map(prev).set(edit.span.id, edit))
  }, [])

  const onClearEdit = useCallback((id: string) => {
    setEdits((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [])

  // ---------- Annotations (formes & images) ----------
  const onAddAnnot = useCallback((annot: Annot) => {
    setAnnots((prev) => new Map(prev).set(annot.id, annot))
    setSelectedAnnot(annot.id)
    // Forme posée : prête à être ajustée. Texte : l'outil reste actif pour
    // pouvoir en poser plusieurs à la suite (Échap ou la flèche pour sortir).
    setTool((t) => (annot.kind === 'text' ? t : 'cursor'))
  }, [])

  const onMoveAnnot = useCallback((id: string, rect: PdfRect) => {
    setAnnots((prev) => {
      const a = prev.get(id)
      if (!a) return prev
      return new Map(prev).set(id, { ...a, rect })
    })
  }, [])

  const deleteAnnot = useCallback((id: string) => {
    setAnnots((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
    setSelectedAnnot((sel) => (sel === id ? null : sel))
  }, [])

  // Suppr/Retour arrière : supprime l'annotation sélectionnée (hors saisie)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
      if (e.key === 'Escape') {
        setTool('cursor')
        setSelectedAnnot(null)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnot) deleteAnnot(selectedAnnot)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedAnnot, deleteAnnot])

  // Insertion d'une image : posée au centre de la page visible
  const onImagePicked = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]
      e.target.value = ''
      if (!f || !baseSizes.length) return
      const img = await loadImageFile(f)
      if (!img) {
        setError('Format d’image non pris en charge.')
        return
      }
      const page = baseSizes[currentPage]
      const s = Math.min((page.width * 0.4) / img.width, (page.height * 0.4) / img.height, 1)
      const w = img.width * s
      const h = img.height * s
      const annot: ImageAnnot = {
        id: crypto.randomUUID(),
        pageIndex: currentPage,
        kind: 'image',
        rect: { x: (page.width - w) / 2, y: (page.height - h) / 2, width: w, height: h },
        bytes: img.bytes,
        mime: img.mime,
        dataUrl: img.dataUrl,
      }
      setAnnots((prev) => new Map(prev).set(annot.id, annot))
      setSelectedAnnot(annot.id)
      setTool('cursor')
    },
    [baseSizes, currentPage]
  )

  // Style : s'applique aux nouveaux objets et à l'objet sélectionné
  const selectedObj = selectedAnnot ? annots.get(selectedAnnot) : null
  const shapeSel = selectedObj && (selectedObj.kind === 'rect' || selectedObj.kind === 'ellipse') ? selectedObj : null
  const textSel = selectedObj?.kind === 'text' ? selectedObj : null
  const applyStyle = useCallback(
    (patch: Partial<{ stroke: string | null; fill: string | null; strokeWidth: number }>) => {
      if (patch.stroke !== undefined) setStroke(patch.stroke)
      if (patch.fill !== undefined) setFill(patch.fill)
      if (patch.strokeWidth !== undefined) setStrokeWidth(patch.strokeWidth)
      setAnnots((prev) => {
        const sel = selectedAnnot ? prev.get(selectedAnnot) : null
        if (!sel || sel.kind === 'image' || sel.kind === 'text') return prev
        const updated = { ...sel, ...patch }
        // Une forme sans contour ni remplissage serait invisible
        if (!updated.stroke && !updated.fill) updated.stroke = '#ff3b30'
        return new Map(prev).set(sel.id, updated)
      })
    },
    [selectedAnnot]
  )

  const applyTextStyle = useCallback(
    (patch: Partial<{ color: string; fontSize: number }>) => {
      if (patch.color !== undefined) setTextColor(patch.color)
      if (patch.fontSize !== undefined) setTextSize(patch.fontSize)
      setAnnots((prev) => {
        const sel = selectedAnnot ? prev.get(selectedAnnot) : null
        if (!sel || sel.kind !== 'text') return prev
        const updated = { ...sel, ...patch }
        // La boîte suit la nouvelle taille de police (coin haut-gauche fixe)
        const size = textAnnotSize(updated.text, updated.fontSize)
        const top = sel.rect.y + sel.rect.height
        updated.rect = { x: sel.rect.x, y: top - size.height, width: size.width, height: size.height }
        return new Map(prev).set(sel.id, updated)
      })
    },
    [selectedAnnot]
  )

  // Contexte du panneau de style : texte ou forme
  const styleContext: 'text' | 'shape' | null =
    tool === 'text'
      ? 'text'
      : tool === 'rect' || tool === 'ellipse'
        ? 'shape'
        : textSel
          ? 'text'
          : shapeSel
            ? 'shape'
            : null
  const curStroke = shapeSel ? shapeSel.stroke : stroke
  const curFill = shapeSel ? shapeSel.fill : fill
  const curWidth = shapeSel ? shapeSel.strokeWidth : strokeWidth
  const curTextColor = textSel ? textSel.color : textColor
  const curTextSize = textSel ? textSel.fontSize : textSize

  const onRenderError = useCallback(() => {
    setError('Le rendu d’une page a échoué.')
  }, [])

  // ---------- Enregistrement ----------
  const savePdf = useCallback(async () => {
    if (!file || totalChanges === 0) return
    setSaving(true)
    setError(null)
    try {
      const bytes = await saveEditedPdf(file.bytes, [...edits.values()], [...annots.values()])
      const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${file.name.replace(/\.pdf$/i, '')}-modifié.pdf`
      a.click()
      // Révocation différée : un gros PDF (images) peut ne pas avoir encore
      // été lu par le téléchargement au moment du clic.
      const url = a.href
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch {
      setError('L’enregistrement a échoué — le PDF est peut-être protégé en écriture.')
    } finally {
      setSaving(false)
    }
  }, [file, edits, annots, totalChanges])

  const zoomBy = useCallback((dir: 1 | -1) => {
    setZoom((z) => {
      const i = ZOOMS.findIndex((v) => Math.abs(v - z) < 0.01)
      return i === -1
        ? dir === 1
          ? 1.15
          : 0.9
        : ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + dir))]
    })
  }, [])

  // Liste unifiée du panneau : textes modifiés + ajouts, triés par page
  const changeList: (
    | { type: 'edit'; page: number; edit: TextEdit }
    | { type: 'annot'; page: number; annot: Annot }
  )[] = [
    ...[...edits.values()].map((edit) => ({ type: 'edit' as const, page: edit.span.pageIndex, edit })),
    ...[...annots.values()].map((annot) => ({ type: 'annot' as const, page: annot.pageIndex, annot })),
  ].sort((a, b) => a.page - b.page)

  const annotLabel = (a: Annot) => {
    if (a.kind === 'image') return 'Image'
    if (a.kind === 'text') {
      const t = a.text.replace(/\n/g, ' ')
      return t.length > 26 ? `${t.slice(0, 26)}…` : t
    }
    return a.kind === 'rect' ? 'Rectangle' : 'Ellipse'
  }
  const annotIcon = (a: Annot): IconName =>
    a.kind === 'image' ? 'image' : a.kind === 'rect' ? 'square' : a.kind === 'ellipse' ? 'circle' : 'type'

  return (
    <div className="pdfedit">
      <header className="topbar">
        <button className="btn" onClick={onClose} title="Retour à l'accueil">
          <Icon name="home" />
          Accueil
        </button>
        <span className="topbar-divider" />
        <span className="pdfedit-title">
          <Icon name="file-text" size={15} />
          Éditeur PDF
          <span className="pdfedit-title-sub">modifier le texte d'un PDF</span>
        </span>
        <span className="topbar-divider" />

        <div className="topbar-group">
          <button
            className="btn"
            onClick={() => openInputRef.current?.click()}
            title="Importer un fichier PDF"
          >
            <Icon name="folder-open" />
            {file ? 'Autre PDF…' : 'Ouvrir un PDF…'}
          </button>
          {file && (
            <span className="pdfedit-file" title={file.name}>
              {file.name}
            </span>
          )}
        </div>

        {doc && (
          <>
            <span className="topbar-divider" />
            <div className="topbar-group" role="toolbar" aria-label="Outils">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  className={tool === t.id ? 'btn btn-icon btn-accent' : 'btn btn-icon'}
                  onClick={() => setTool(t.id)}
                  title={t.label}
                >
                  <Icon name={t.icon} />
                </button>
              ))}
              <button
                className="btn btn-icon"
                onClick={() => imgInputRef.current?.click()}
                title="Insérer une image sur la page visible"
              >
                <Icon name="image" />
              </button>
            </div>
            <span className="topbar-divider" />
            <div className="topbar-group" aria-label="Pages">
              <button
                className="btn btn-icon"
                onClick={() => gotoPage(currentPage - 1)}
                disabled={currentPage === 0}
                title="Page précédente"
              >
                ‹
              </button>
              <span className="pdfedit-pageinfo">
                {currentPage + 1} / {numPages}
              </span>
              <button
                className="btn btn-icon"
                onClick={() => gotoPage(currentPage + 1)}
                disabled={currentPage >= numPages - 1}
                title="Page suivante"
              >
                ›
              </button>
            </div>
            <div className="topbar-group" aria-label="Zoom">
              <button className="btn btn-icon" onClick={() => zoomBy(-1)} title="Réduire">
                −
              </button>
              <span className="pdfedit-pageinfo">{Math.round(zoom * 100)} %</span>
              <button className="btn btn-icon" onClick={() => zoomBy(1)} title="Agrandir">
                +
              </button>
            </div>
          </>
        )}

        <div className="topbar-group topbar-right">
          {totalChanges > 0 && (
            <button
              className="btn"
              onClick={() => {
                setEdits(new Map())
                setAnnots(new Map())
                setSelectedAnnot(null)
              }}
              title="Annuler toutes les modifications et tous les ajouts"
            >
              <Icon name="undo" />
              Tout annuler
            </button>
          )}
          <button
            className="btn-primary"
            onClick={() => void savePdf()}
            disabled={!file || totalChanges === 0 || saving}
            title="Télécharger une copie du PDF avec les modifications et les ajouts"
          >
            <Icon name="download" />
            {saving
              ? 'Préparation…'
              : `Enregistrer le PDF${totalChanges ? ` (${totalChanges})` : ''}`}
          </button>
        </div>
      </header>

      <div
        className="pdfedit-stage"
        ref={stageRef}
        onScroll={onScroll}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        {!doc && (
          <div className="pdfedit-empty">
            <Icon name="file-text" size={44} />
            <h2>Modifier le texte d'un PDF</h2>
            <p>
              Importez un PDF : chaque texte devient cliquable, et vous pouvez poser des formes et
              des images par-dessus. Enregistrez ensuite une copie modifiée — l'original reste
              intact.
            </p>
            <button className="btn-primary" onClick={() => openInputRef.current?.click()}>
              <Icon name="folder-open" />
              {loading ? 'Ouverture…' : 'Ouvrir un PDF…'}
            </button>
            <span className="pdfedit-drop-hint">ou déposez le fichier ici</span>
          </div>
        )}

        {doc &&
          baseSizes.map((size, i) => (
            <div
              key={i}
              data-slot={i}
              className="pdfedit-slot"
              ref={(el) => {
                if (el) slotsRef.current.set(i, el)
                else slotsRef.current.delete(i)
              }}
            >
              <PdfPage
                doc={doc}
                pageIndex={i}
                scale={scale}
                baseSize={size}
                visible={visiblePages.has(i)}
                tool={tool}
                shapeStyle={{ stroke, fill, strokeWidth }}
                textStyle={{ color: textColor, fontSize: textSize }}
                edits={edits}
                annots={[...annots.values()].filter((a) => a.pageIndex === i)}
                selectedAnnot={selectedAnnot}
                onEdit={onEdit}
                onClearEdit={onClearEdit}
                onAddAnnot={onAddAnnot}
                onMoveAnnot={onMoveAnnot}
                onSelectAnnot={setSelectedAnnot}
                onRenderError={onRenderError}
              />
            </div>
          ))}

        {/* Style : formes (contour/fond/épaisseur) ou texte (couleur/taille) */}
        {doc && styleContext === 'shape' && (
          <aside className="pdfedit-style">
            <div className="pdfedit-style-row">
              <span className="pdfedit-style-label">Contour</span>
              <button
                className={`pdfedit-swatch pdfedit-swatch-none${curStroke === null ? ' is-active' : ''}`}
                onClick={() => applyStyle({ stroke: null })}
                title="Sans contour"
              />
              {PALETTE.map((c) => (
                <button
                  key={c}
                  className={`pdfedit-swatch${curStroke === c ? ' is-active' : ''}`}
                  style={{ background: c }}
                  onClick={() => applyStyle({ stroke: c })}
                  title={`Contour ${c}`}
                />
              ))}
              {WIDTHS.map((wd) => (
                <button
                  key={wd}
                  className={`pdfedit-width${curWidth === wd ? ' is-active' : ''}`}
                  onClick={() => applyStyle({ strokeWidth: wd })}
                  title={`Épaisseur ${wd}`}
                >
                  <span style={{ height: Math.max(1.5, wd) }} />
                </button>
              ))}
            </div>
            <div className="pdfedit-style-row">
              <span className="pdfedit-style-label">Fond</span>
              <button
                className={`pdfedit-swatch pdfedit-swatch-none${curFill === null ? ' is-active' : ''}`}
                onClick={() => applyStyle({ fill: null })}
                title="Sans remplissage"
              />
              {PALETTE.map((c) => (
                <button
                  key={c}
                  className={`pdfedit-swatch${curFill === c ? ' is-active' : ''}`}
                  style={{ background: c }}
                  onClick={() => applyStyle({ fill: c })}
                  title={`Remplissage ${c}`}
                />
              ))}
            </div>
          </aside>
        )}
        {doc && styleContext === 'text' && (
          <aside className="pdfedit-style">
            <div className="pdfedit-style-row">
              <span className="pdfedit-style-label">Couleur</span>
              {PALETTE.map((c) => (
                <button
                  key={c}
                  className={`pdfedit-swatch${curTextColor === c ? ' is-active' : ''}`}
                  style={{ background: c }}
                  onClick={() => applyTextStyle({ color: c })}
                  title={`Couleur ${c}`}
                />
              ))}
            </div>
            <div className="pdfedit-style-row">
              <span className="pdfedit-style-label">Taille</span>
              {TEXT_SIZES.map((s) => (
                <button
                  key={s}
                  className={`pdfedit-size${curTextSize === s ? ' is-active' : ''}`}
                  onClick={() => applyTextStyle({ fontSize: s })}
                  title={`${s} pt`}
                >
                  {s}
                </button>
              ))}
            </div>
          </aside>
        )}

        {changeList.length > 0 && (
          <aside className="pdfedit-edits">
            <div className="pdfedit-edits-head">
              <span>
                <Icon name="layers" size={14} />
                Modifications ({changeList.length})
              </span>
            </div>
            <ul>
              {changeList.map((item) => (
                <li key={item.type === 'edit' ? item.edit.span.id : item.annot.id}>
                  <button
                    className="pdfedit-edit-jump"
                    onClick={() => gotoPage(item.page)}
                    title={`Aller à la page ${item.page + 1}`}
                  >
                    <span className="pdfedit-edit-page">p. {item.page + 1}</span>
                    {item.type === 'edit' ? (
                      <span className="pdfedit-edit-texts">
                        <s>{item.edit.span.str}</s>
                        <b>{item.edit.text.trim() ? item.edit.text : '(texte effacé)'}</b>
                      </span>
                    ) : (
                      <span className="pdfedit-edit-texts pdfedit-edit-annot">
                        <Icon name={annotIcon(item.annot)} size={12} />
                        <b>{annotLabel(item.annot)}</b>
                      </span>
                    )}
                  </button>
                  <button
                    className="btn btn-icon"
                    onClick={() =>
                      item.type === 'edit'
                        ? onClearEdit(item.edit.span.id)
                        : deleteAnnot(item.annot.id)
                    }
                    title={item.type === 'edit' ? 'Annuler cette modification' : 'Supprimer cet ajout'}
                  >
                    <Icon name={item.type === 'edit' ? 'undo' : 'trash'} size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}

        {error && (
          <div className="pdfedit-error" role="alert">
            {error}
            <button className="btn btn-icon" onClick={() => setError(null)} title="Fermer">
              <Icon name="x" size={13} />
            </button>
          </div>
        )}
      </div>

      <footer className="statusbar">
        <span>
          {doc
            ? tool === 'cursor'
              ? 'Cliquez sur un texte pour le modifier — double-clic sur un texte ajouté pour le rééditer, Suppr efface la sélection'
              : tool === 'text'
                ? 'Cliquez à l’endroit voulu et tapez — Entrée = nouvelle ligne, cliquer ailleurs valide, Échap annule'
                : 'Glissez sur la page pour tracer la forme — Échap ou l’outil flèche pour revenir à la sélection'
            : 'Aucun document ouvert'}
        </span>
        <span>
          {totalChanges > 0
            ? `${totalChanges} modification${totalChanges > 1 ? 's' : ''} en attente d'enregistrement`
            : 'Le fichier d’origine n’est jamais modifié : l’export crée une copie'}
        </span>
      </footer>

      <input
        ref={openInputRef}
        type="file"
        accept=".pdf,application/pdf"
        style={{ display: 'none' }}
        onChange={onFilePicked}
      />
      <input
        ref={imgInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => void onImagePicked(e)}
      />
    </div>
  )
}
