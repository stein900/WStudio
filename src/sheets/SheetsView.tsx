/**
 * Tableur — module autonome plein écran : feuilles de calcul type tableur
 * (grille, barre de formule, formules, mise en forme, fusion de cellules,
 * feuilles multiples), import de classeurs Excel (.xlsx, .xls) et CSV,
 * export en .xlsx ou .csv. Chaque tableur est un projet à part entière
 * (Documents\WStudio\<Nom>\classeur.json), sauvegardé automatiquement —
 * comme les projets Documents.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Spreadsheet from 'x-data-spreadsheet'
import * as XLSX from 'xlsx'
import { Icon } from '../components/Icons'
import { desktop, type SheetProjectData } from '../lib/desktop'
import { LOCALE_FR } from './locale-fr'
import {
  MIN_COLS,
  MIN_ROWS,
  readWorkbookFile,
  sheetHasContent,
  sheetToWs,
  sheetsToWorkbook,
  workbookToSheets,
  type XsSheet,
} from './xlsx'
import './sheets.css'

interface Props {
  project: SheetProjectData
  onClose: () => void
}

Spreadsheet.locale('fr', LOCALE_FR)

/** loadData accepte un tableau de feuilles ; le typage publié ne le sait pas. */
function loadSheets(s: Spreadsheet, data: XsSheet[]) {
  s.loadData(data as unknown as Record<string, unknown>)
}

/** Index de la feuille affichée (onglet actif), via l'état interne. */
function activeSheetIndex(s: Spreadsheet): number {
  const internal = s as unknown as { datas: unknown[]; sheet: { data: unknown } }
  const i = internal.datas.indexOf(internal.sheet.data)
  return i >= 0 ? i : 0
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  const url = a.href
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function SheetsView({ project, onClose }: Props) {
  const gridRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<Spreadsheet | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'saving'>('saved')
  const [error, setError] = useState<string | null>(null)

  // Dernier état écrit sur disque (JSON) : évite les écritures inutiles et
  // permet au filet périodique de capter les changements sans événement
  // « change » (ajout, renommage ou suppression de feuille).
  const lastSavedRef = useRef<string>('')

  const persistRef = useRef<() => Promise<void>>(async () => {})
  persistRef.current = async () => {
    const s = sheetRef.current
    const d = desktop
    if (!s || !d) return
    const data = s.getData() as XsSheet[]
    const json = JSON.stringify(data)
    if (json === lastSavedRef.current) {
      setSaveState('saved')
      return
    }
    setSaveState('saving')
    try {
      await d.saveSheetProject({ path: project.path, data })
      lastSavedRef.current = json
      setSaveState('saved')
    } catch {
      setSaveState('pending') // réessayé par le filet périodique
    }
  }

  // Filet de sécurité synchrone (fermeture de fenêtre, retour à l'accueil)
  const flushRef = useRef<() => void>(() => {})
  flushRef.current = () => {
    const s = sheetRef.current
    if (!s || !desktop) return
    const data = s.getData() as XsSheet[]
    const json = JSON.stringify(data)
    if (json === lastSavedRef.current) return
    desktop.saveSheetProjectNow({ path: project.path, data })
    lastSavedRef.current = json
  }

  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const s = new Spreadsheet(el, {
      mode: 'edit',
      showToolbar: true,
      showGrid: true,
      showContextmenu: true,
      showBottomBar: true,
      view: { height: () => el.clientHeight, width: () => el.clientWidth },
      row: { len: MIN_ROWS, height: 25 },
      col: { len: MIN_COLS, width: 100, indexWidth: 60, minWidth: 60 },
    })
    sheetRef.current = s
    const data = Array.isArray(project.data) && project.data.length > 0
      ? (project.data as XsSheet[])
      : [{ name: 'Feuille1', rows: {} }]
    loadSheets(s, data)
    lastSavedRef.current = JSON.stringify(s.getData())

    // Le bouton « + » nomme les feuilles « sheetN » : franciser en FeuilleN
    const internal = s as unknown as {
      addSheet: (name?: string, active?: boolean) => unknown
      datas: { name: string }[]
    }
    const origAddSheet = internal.addSheet.bind(s)
    internal.addSheet = (name?: string, active?: boolean) => {
      if (!name) {
        let n = internal.datas.length + 1
        while (internal.datas.some((d) => d.name === `Feuille${n}`)) n++
        name = `Feuille${n}`
      }
      return origAddSheet(name, active)
    }

    let t: number | undefined
    s.change(() => {
      setSaveState('pending')
      window.clearTimeout(t)
      t = window.setTimeout(() => void persistRef.current(), 1000)
    })
    // Ajout, renommage ou suppression de feuille ne déclenchent pas
    // « change » : le filet périodique compare l'état au dernier écrit et
    // sauvegarde dès qu'ils diffèrent.
    const iv = window.setInterval(() => void persistRef.current(), 10_000)

    return () => {
      window.clearTimeout(t)
      window.clearInterval(iv)
      flushRef.current()
      // La grille écoute le clavier au niveau de la fenêtre tant qu'elle se
      // croit focalisée : neutraliser avant démontage pour ne pas intercepter
      // Ctrl+Z (etc.) dans le reste de l'application.
      ;(s as unknown as { sheet: { focusing: boolean } }).sheet.focusing = false
      sheetRef.current = null
      el.innerHTML = ''
    }
  }, [project.path]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sauvegarde immédiate à la fermeture de la fenêtre, et Ctrl+S manuel
  useEffect(() => {
    const flush = () => flushRef.current()
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void persistRef.current()
      }
    }
    window.addEventListener('beforeunload', flush)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('beforeunload', flush)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const importFile = useCallback(async (f: File) => {
    const s = sheetRef.current
    if (!s) return
    setError(null)
    try {
      const wb = await readWorkbookFile(f)
      const data = workbookToSheets(wb)
      if (data.length === 0) throw new Error('classeur vide')
      const current = s.getData() as XsSheet[]
      if (
        current.some(sheetHasContent) &&
        !window.confirm(`Importer « ${f.name} » ? Le contenu actuel de ce tableur sera remplacé.`)
      ) {
        return
      }
      loadSheets(s, data)
      void persistRef.current()
    } catch {
      setError(
        `« ${f.name} » n'a pas pu être lu : est-ce bien un fichier Excel (.xlsx, .xls) ou CSV valide ?`
      )
    }
  }, [])

  const exportXlsx = useCallback(() => {
    const s = sheetRef.current
    if (!s) return
    setError(null)
    void persistRef.current()
    try {
      const wb = sheetsToWorkbook(s.getData() as XsSheet[])
      const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
      download(
        new Blob([bytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        `${project.name}.xlsx`
      )
    } catch {
      setError("L'export Excel a échoué — réessayez après avoir simplifié le classeur.")
    }
  }, [project.name])

  const exportCsv = useCallback(() => {
    const s = sheetRef.current
    if (!s) return
    setError(null)
    void persistRef.current()
    try {
      const data = s.getData() as XsSheet[]
      const sheet = data[activeSheetIndex(s)] ?? data[0]
      if (!sheet) return
      // Séparateur « ; » + BOM UTF-8 : le CSV s'ouvre correctement dans un
      // Excel configuré en français, accents compris.
      const csv = XLSX.utils.sheet_to_csv(sheetToWs(sheet), { FS: ';' })
      const name =
        data.length > 1 ? `${project.name} - ${sheet.name || 'feuille'}.csv` : `${project.name}.csv`
      download(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), name)
    } catch {
      setError("L'export CSV a échoué.")
    }
  }, [project.name])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const f = [...(e.dataTransfer.files ?? [])].find((x) =>
        /\.(xlsx|xlsm|xls|csv)$/i.test(x.name)
      )
      if (f) void importFile(f)
    },
    [importFile]
  )

  const close = useCallback(() => {
    flushRef.current() // ne rien perdre en quittant le module
    onClose()
  }, [onClose])

  return (
    <div className="sheets">
      <header className="topbar">
        <button className="btn" onClick={close} title="Retour à l'accueil">
          <Icon name="home" />
          Accueil
        </button>
        <span className="topbar-divider" />
        <span className="sheets-title">
          <Icon name="grid" size={15} />
          Tableur
        </span>
        <span className="topbar-divider" />
        <div className="topbar-group">
          <button
            className="project-chip"
            title={
              project.temporary
                ? `Tableur temporaire — ${project.path}`
                : `Ouvrir le dossier ${project.path}`
            }
            onClick={() => void desktop?.revealProject(project.path)}
          >
            <Icon name={project.temporary ? 'clock' : 'folder'} size={13} />
            {project.name}
          </button>
          <button
            className={`save-pill save-${saveState}`}
            title="Enregistrer maintenant (Ctrl+S) — sauvegarde automatique en continu"
            onClick={() => void persistRef.current()}
          >
            {saveState === 'saved' ? (
              <Icon name="check" size={13} />
            ) : (
              <span className="save-spinner" />
            )}
            {saveState === 'saved' ? 'Enregistré' : 'Enregistrement…'}
          </button>
        </div>

        <div className="topbar-group topbar-right">
          <button
            className="btn"
            onClick={() => inputRef.current?.click()}
            title="Importer un classeur Excel (.xlsx, .xls) ou un CSV dans ce tableur (remplace son contenu)"
          >
            <Icon name="folder-open" />
            Importer…
          </button>
          <button
            className="btn"
            onClick={exportCsv}
            title="Exporter la feuille affichée en CSV (séparateur « ; », UTF-8)"
          >
            <Icon name="download" />
            Exporter CSV
          </button>
          <button
            className="btn-primary"
            onClick={exportXlsx}
            title="Exporter tout le classeur au format Excel (.xlsx) — valeurs, formules et fusions"
          >
            <Icon name="file-down" />
            Exporter Excel
          </button>
        </div>
      </header>

      <div className="sheets-stage" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <div ref={gridRef} className="sheets-grid" />
        {error && (
          <div className="sheets-error" role="alert">
            {error}
            <button className="btn btn-icon" onClick={() => setError(null)} title="Fermer">
              <Icon name="x" size={13} />
            </button>
          </div>
        )}
      </div>

      <footer className="statusbar">
        <span>
          Formules : =SUM(A1:B4), =AVERAGE… — clic droit : insérer ou supprimer lignes et
          colonnes — double-clic sur un onglet pour renommer la feuille
        </span>
        <span>
          <span className="status-dot" />
          {project.temporary
            ? 'Tableur temporaire — non conservé dans vos documents'
            : `Enregistré — WStudio\\${project.name}`}
        </span>
      </footer>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xlsm,.xls,.csv"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void importFile(f)
        }}
      />
    </div>
  )
}
