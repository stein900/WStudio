/**
 * Outils PDF — module autonome plein écran, deux volets :
 * — Fusionner : on ajoute plusieurs PDF, chaque document apparaît en vignette
 *   (première page) avec son nombre de pages ; on réorganise (flèches),
 *   on retire, puis on exporte le PDF fusionné.
 * — Compresser : un PDF, deux stratégies — « sans perte » (réécriture
 *   compacte du fichier) ou « forte » (pages re-rendues en images JPEG,
 *   qualité au choix : idéal pour les scans volumineux).
 * Les fichiers d'origine ne sont jamais modifiés : chaque export est une copie.
 */

import { useCallback, useRef, useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { Icon } from '../components/Icons'
import { loadPdf, renderPage } from '../pdfedit/pdf'
import './pdftools.css'

interface Props {
  onClose: () => void
}

interface MergeItem {
  id: string
  name: string
  bytes: ArrayBuffer
  pages: number
  size: number
  /** Vignette de la première page (data URL). */
  thumb: string
}

type CompressMode = 'lossless' | 'image'

const QUALITIES = [
  { id: 'forte', label: 'Forte', hint: 'fichier le plus léger', scale: 1.2, q: 0.5 },
  { id: 'moyenne', label: 'Moyenne', hint: 'bon compromis', scale: 1.5, q: 0.65 },
  { id: 'legere', label: 'Légère', hint: 'meilleure qualité', scale: 2, q: 0.8 },
] as const

function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`
  return `${(n / (1024 * 1024)).toFixed(2)} Mo`
}

function download(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  const url = a.href
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** Vignette (première page) + nombre de pages d'un PDF. */
async function inspectPdf(bytes: ArrayBuffer): Promise<{ thumb: string; pages: number }> {
  const doc = await loadPdf(bytes)
  try {
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const vp = page.getViewport({ scale: 150 / base.width })
    const canvas = document.createElement('canvas')
    await renderPage(page, canvas, vp)
    return { thumb: canvas.toDataURL('image/png'), pages: doc.numPages }
  } finally {
    void doc.loadingTask.destroy()
  }
}

export function PdfToolsView({ onClose }: Props) {
  const [tab, setTab] = useState<'merge' | 'compress'>('merge')
  const [error, setError] = useState<string | null>(null)

  // ---------- Fusion ----------
  const [items, setItems] = useState<MergeItem[]>([])
  const [merging, setMerging] = useState(false)
  const mergeInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback(async (files: File[]) => {
    setError(null)
    for (const f of files) {
      try {
        const bytes = await f.arrayBuffer()
        const info = await inspectPdf(bytes)
        setItems((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            name: f.name,
            bytes,
            pages: info.pages,
            size: bytes.byteLength,
            thumb: info.thumb,
          },
        ])
      } catch {
        setError(`« ${f.name} » n'a pas pu être lu : est-ce bien un PDF valide (non protégé) ?`)
      }
    }
  }, [])

  const moveItem = useCallback((id: string, dir: -1 | 1) => {
    setItems((prev) => {
      const i = prev.findIndex((it) => it.id === id)
      const j = i + dir
      if (i === -1 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }, [])

  const mergePdfs = useCallback(async () => {
    if (items.length < 2) return
    setMerging(true)
    setError(null)
    try {
      const out = await PDFDocument.create()
      for (const it of items) {
        const src = await PDFDocument.load(it.bytes, { ignoreEncryption: true })
        const pages = await out.copyPages(src, src.getPageIndices())
        for (const p of pages) out.addPage(p)
      }
      download(await out.save(), 'fusion.pdf')
    } catch {
      setError('La fusion a échoué — un des PDF est peut-être endommagé ou protégé.')
    } finally {
      setMerging(false)
    }
  }, [items])

  // ---------- Compression ----------
  const [comp, setComp] = useState<{ name: string; bytes: ArrayBuffer; pages: number; thumb: string } | null>(null)
  const [mode, setMode] = useState<CompressMode>('image')
  const [quality, setQuality] = useState<(typeof QUALITIES)[number]['id']>('moyenne')
  const [progress, setProgress] = useState<number | null>(null)
  const [result, setResult] = useState<{ bytes: Uint8Array; before: number } | null>(null)
  const compInputRef = useRef<HTMLInputElement>(null)

  const pickCompress = useCallback(async (f: File) => {
    setError(null)
    setResult(null)
    try {
      const bytes = await f.arrayBuffer()
      const info = await inspectPdf(bytes)
      setComp({ name: f.name, bytes, pages: info.pages, thumb: info.thumb })
    } catch {
      setError(`« ${f.name} » n'a pas pu être lu : est-ce bien un PDF valide (non protégé) ?`)
    }
  }, [])

  const compress = useCallback(async () => {
    if (!comp) return
    setProgress(0)
    setResult(null)
    setError(null)
    try {
      let bytes: Uint8Array
      if (mode === 'lossless') {
        const doc = await PDFDocument.load(comp.bytes, { ignoreEncryption: true })
        bytes = await doc.save({ useObjectStreams: true })
      } else {
        // Chaque page est re-rendue en JPEG : très efficace sur les scans,
        // mais le texte n'est plus sélectionnable dans la copie compressée.
        const preset = QUALITIES.find((q) => q.id === quality) ?? QUALITIES[1]
        const src = await loadPdf(comp.bytes)
        try {
          const out = await PDFDocument.create()
          for (let i = 1; i <= src.numPages; i++) {
            const page = await src.getPage(i)
            const base = page.getViewport({ scale: 1 })
            const vp = page.getViewport({ scale: preset.scale })
            const canvas = document.createElement('canvas')
            // Rendu sans tenir compte du devicePixelRatio : l'échelle du
            // préréglage EST la résolution voulue.
            canvas.width = Math.floor(vp.width)
            canvas.height = Math.floor(vp.height)
            await page.render({ canvas, viewport: vp }).promise
            const blob = await new Promise<Blob | null>((res) =>
              canvas.toBlob(res, 'image/jpeg', preset.q)
            )
            if (!blob) throw new Error('encodage')
            const img = await out.embedJpg(await blob.arrayBuffer())
            const p = out.addPage([base.width, base.height])
            p.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height })
            canvas.width = 0
            canvas.height = 0
            setProgress(i / src.numPages)
          }
          bytes = await out.save()
        } finally {
          void src.loadingTask.destroy()
        }
      }
      setResult({ bytes, before: comp.bytes.byteLength })
    } catch {
      setError('La compression a échoué — le PDF est peut-être endommagé ou protégé.')
    } finally {
      setProgress(null)
    }
  }, [comp, mode, quality])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const files = [...(e.dataTransfer.files ?? [])].filter((f) => /\.pdf$/i.test(f.name))
      if (!files.length) return
      if (tab === 'merge') void addFiles(files)
      else void pickCompress(files[0])
    },
    [tab, addFiles, pickCompress]
  )

  const totalPages = items.reduce((n, it) => n + it.pages, 0)
  const totalSize = items.reduce((n, it) => n + it.size, 0)

  return (
    <div className="pdftools">
      <header className="topbar">
        <button className="btn" onClick={onClose} title="Retour à l'accueil">
          <Icon name="home" />
          Accueil
        </button>
        <span className="topbar-divider" />
        <span className="pdftools-title">
          <Icon name="layers" size={15} />
          Outils PDF
          <span className="pdftools-title-sub">fusionner &amp; compresser</span>
        </span>
        <span className="topbar-divider" />
        <div className="mode-switch">
          <button
            className={tab === 'merge' ? 'is-active' : ''}
            onClick={() => setTab('merge')}
            title="Assembler plusieurs PDF en un seul, dans l'ordre choisi"
          >
            <Icon name="copy" size={14} />
            Fusionner
          </button>
          <button
            className={tab === 'compress' ? 'is-active' : ''}
            onClick={() => setTab('compress')}
            title="Réduire le poids d'un PDF"
          >
            <Icon name="file-down" size={14} />
            Compresser
          </button>
        </div>

        <div className="topbar-group topbar-right">
          {tab === 'merge' && (
            <>
              <button className="btn" onClick={() => mergeInputRef.current?.click()}>
                <Icon name="file-plus" />
                Ajouter des PDF…
              </button>
              <button
                className="btn-primary"
                disabled={items.length < 2 || merging}
                onClick={() => void mergePdfs()}
                title="Assembler les documents dans l'ordre affiché et télécharger le résultat"
              >
                <Icon name="download" />
                {merging
                  ? 'Fusion…'
                  : `Fusionner${items.length > 1 ? ` (${items.length} fichiers)` : ''}`}
              </button>
            </>
          )}
          {tab === 'compress' && (
            <button className="btn" onClick={() => compInputRef.current?.click()}>
              <Icon name="folder-open" />
              {comp ? 'Autre PDF…' : 'Ouvrir un PDF…'}
            </button>
          )}
        </div>
      </header>

      <div className="pdftools-stage" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        {tab === 'merge' &&
          (items.length === 0 ? (
            <div className="pdftools-empty">
              <Icon name="copy" size={44} />
              <h2>Fusionner des PDF</h2>
              <p>
                Ajoutez plusieurs fichiers PDF : chacun apparaît avec un aperçu de sa première
                page. Réorganisez-les avec les flèches, puis exportez le document assemblé.
              </p>
              <button className="btn-primary" onClick={() => mergeInputRef.current?.click()}>
                <Icon name="file-plus" />
                Ajouter des PDF…
              </button>
              <span className="pdftools-drop-hint">ou déposez les fichiers ici</span>
            </div>
          ) : (
            <>
              <div className="pdftools-grid">
                {items.map((it, i) => (
                  <div key={it.id} className="pdftools-card">
                    <div className="pdftools-card-order">{i + 1}</div>
                    <img src={it.thumb} alt="" draggable={false} />
                    <div className="pdftools-card-name" title={it.name}>
                      {it.name}
                    </div>
                    <div className="pdftools-card-meta">
                      {it.pages} page{it.pages > 1 ? 's' : ''} — {formatBytes(it.size)}
                    </div>
                    <div className="pdftools-card-actions">
                      <button
                        className="btn btn-icon"
                        disabled={i === 0}
                        onClick={() => moveItem(it.id, -1)}
                        title="Avancer dans l'ordre"
                      >
                        ‹
                      </button>
                      <button
                        className="btn btn-icon"
                        disabled={i === items.length - 1}
                        onClick={() => moveItem(it.id, 1)}
                        title="Reculer dans l'ordre"
                      >
                        ›
                      </button>
                      <button
                        className="btn btn-icon"
                        onClick={() => setItems((prev) => prev.filter((x) => x.id !== it.id))}
                        title="Retirer ce document"
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  className="pdftools-card pdftools-card-add"
                  onClick={() => mergeInputRef.current?.click()}
                  title="Ajouter d'autres PDF"
                >
                  <Icon name="plus" size={28} />
                  Ajouter
                </button>
              </div>
              <div className="pdftools-summary">
                Document final : {totalPages} page{totalPages > 1 ? 's' : ''} —{' '}
                {formatBytes(totalSize)} avant fusion
              </div>
            </>
          ))}

        {tab === 'compress' &&
          (!comp ? (
            <div className="pdftools-empty">
              <Icon name="file-down" size={44} />
              <h2>Compresser un PDF</h2>
              <p>
                Réduisez le poids d'un PDF : compression « sans perte » (le contenu reste
                intact), ou compression forte en convertissant les pages en images — idéale pour
                les scans volumineux.
              </p>
              <button className="btn-primary" onClick={() => compInputRef.current?.click()}>
                <Icon name="folder-open" />
                Ouvrir un PDF…
              </button>
              <span className="pdftools-drop-hint">ou déposez le fichier ici</span>
            </div>
          ) : (
            <div className="pdftools-compress">
              <div className="pdftools-card">
                <img src={comp.thumb} alt="" draggable={false} />
                <div className="pdftools-card-name" title={comp.name}>
                  {comp.name}
                </div>
                <div className="pdftools-card-meta">
                  {comp.pages} page{comp.pages > 1 ? 's' : ''} —{' '}
                  {formatBytes(comp.bytes.byteLength)}
                </div>
              </div>

              <div className="pdftools-options">
                <label className={`pdftools-option${mode === 'lossless' ? ' is-active' : ''}`}>
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === 'lossless'}
                    onChange={() => setMode('lossless')}
                  />
                  <div>
                    <b>Sans perte</b>
                    <span>
                      Réécriture compacte du fichier : contenu et texte strictement identiques.
                      Gain modeste (souvent 5 à 20 %).
                    </span>
                  </div>
                </label>
                <label className={`pdftools-option${mode === 'image' ? ' is-active' : ''}`}>
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === 'image'}
                    onChange={() => setMode('image')}
                  />
                  <div>
                    <b>Forte (pages en images)</b>
                    <span>
                      Chaque page est convertie en image JPEG : gain important, surtout sur les
                      scans — mais le texte n'est plus sélectionnable.
                    </span>
                    {mode === 'image' && (
                      <div className="pdftools-qualities">
                        {QUALITIES.map((q) => (
                          <button
                            key={q.id}
                            className={quality === q.id ? 'is-active' : ''}
                            onClick={(e) => {
                              e.preventDefault()
                              setQuality(q.id)
                            }}
                            title={q.hint}
                          >
                            {q.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </label>

                <button
                  className="btn-primary"
                  disabled={progress !== null}
                  onClick={() => void compress()}
                >
                  <Icon name="file-down" />
                  {progress !== null
                    ? `Compression… ${Math.round(progress * 100)} %`
                    : 'Compresser'}
                </button>
                {progress !== null && (
                  <div className="pdftools-progress">
                    <div style={{ width: `${Math.round(progress * 100)}%` }} />
                  </div>
                )}

                {result && (
                  <div className="pdftools-result">
                    <div>
                      {formatBytes(result.before)} → <b>{formatBytes(result.bytes.length)}</b>{' '}
                      {result.bytes.length < result.before ? (
                        <span className="pdftools-gain">
                          (−{Math.round((1 - result.bytes.length / result.before) * 100)} %)
                        </span>
                      ) : (
                        <span className="pdftools-nogain">
                          (aucun gain — ce PDF est déjà très compact ; essayez la compression
                          forte)
                        </span>
                      )}
                    </div>
                    <button
                      className="btn-primary"
                      onClick={() =>
                        download(result.bytes, `${comp.name.replace(/\.pdf$/i, '')}-compressé.pdf`)
                      }
                    >
                      <Icon name="download" />
                      Télécharger le PDF compressé
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

        {error && (
          <div className="pdftools-error" role="alert">
            {error}
            <button className="btn btn-icon" onClick={() => setError(null)} title="Fermer">
              <Icon name="x" size={13} />
            </button>
          </div>
        )}
      </div>

      <footer className="statusbar">
        <span>
          {tab === 'merge'
            ? 'L’ordre des vignettes est l’ordre du document final — flèches pour réorganiser'
            : 'La compression crée une copie : le fichier d’origine reste intact'}
        </span>
        <span>
          {tab === 'merge' && items.length > 0
            ? `${items.length} document${items.length > 1 ? 's' : ''} — ${totalPages} page${totalPages > 1 ? 's' : ''} au total`
            : ''}
        </span>
      </footer>

      <input
        ref={mergeInputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) void addFiles(files)
        }}
      />
      <input
        ref={compInputRef}
        type="file"
        accept=".pdf,application/pdf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void pickCompress(f)
        }}
      />
    </div>
  )
}
