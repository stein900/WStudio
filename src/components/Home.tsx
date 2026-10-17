import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  desktop,
  type ProjectData,
  type ProjectInfo,
  type SheetProjectData,
  type SheetProjectInfo,
} from '../lib/desktop'
import { readWorkbookFile, sheetHasContent, workbookToSheets, type XsSheet } from '../sheets/xlsx'
import { renderMarkdown } from '../lib/markdown'
import { toEditorMarkdown } from '../lib/assets'
import logoUrl from '../assets/wstudio-logo.png'
import { Icon, type IconName } from './Icons'

interface Props {
  onOpenProject: (project: ProjectData) => void
  /** Ouvre un projet tableur dans le module Tableur. */
  onOpenSheetProject: (project: SheetProjectData) => void
  /** Incrémenté par le menu « Nouveau projet » pour ouvrir la boîte de création. */
  createSignal: number
  /** Section affichée à l'ouverture (retour depuis un module : sa section). */
  initialSection?: Section
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  /** Ouvre le module Paint (dessins & schémas). */
  onOpenPaint: () => void
  /** Ouvre l'Éditeur PDF (modification du texte d'un PDF existant). */
  onOpenPdfEdit: () => void
  /** Ouvre les Outils PDF (fusion de plusieurs PDF, compression). */
  onOpenPdfTools: () => void
}

/** Section de l'accueil : chaque type de projet a sa liste et ses actions. */
export type Section = 'docs' | 'sheets'

function relativeDate(ms: number): string {
  const diff = Date.now() - ms
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'à l’instant'
  if (min < 60) return `il y a ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `il y a ${h} h`
  const d = Math.round(h / 24)
  if (d < 30) return d === 1 ? 'hier' : `il y a ${d} jours`
  return new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * Vignette « première page » d'un projet document : le début du markdown est
 * rendu en HTML sur une page blanche réduite (mémoïsé — le rendu ne rejoue
 * pas à chaque frappe dans la boîte de création).
 */
const DocThumb = memo(function DocThumb({ excerpt, path }: { excerpt: string; path: string }) {
  const html = useMemo(() => {
    try {
      // [TOC] retiré : pas de sommaire dans une vignette ; images résolues
      // via le protocole interne (assets/ du projet).
      const source = toEditorMarkdown(excerpt, path).replace(/^\[TOC\]\s*$/gim, '')
      return renderMarkdown(source)
    } catch {
      return ''
    }
  }, [excerpt, path])
  return (
    <span className="project-thumb" aria-hidden="true">
      <span className="thumb-doc" dangerouslySetInnerHTML={{ __html: html }} />
    </span>
  )
})

/** Vignette grille d'un projet tableur : coin haut-gauche de la première feuille. */
const SheetThumb = memo(function SheetThumb({ preview }: { preview?: string[][] }) {
  const rows =
    preview && preview.length > 0
      ? preview
      : Array.from({ length: 10 }, () => Array<string>(6).fill(''))
  return (
    <span className="project-thumb project-thumb-sheet" aria-hidden="true">
      <span className="thumb-sheet">
        {rows.map((r, i) => (
          <span key={i} className="thumb-sheet-row">
            {r.map((c, j) => (
              <span key={j} className="thumb-sheet-cell">
                {c}
              </span>
            ))}
          </span>
        ))}
      </span>
    </span>
  )
})

export function Home({
  onOpenProject,
  onOpenSheetProject,
  createSignal,
  initialSection,
  theme,
  onToggleTheme,
  onOpenPaint,
  onOpenPdfEdit,
  onOpenPdfTools,
}: Props) {
  const [section, setSection] = useState<Section>(initialSection ?? 'docs')
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null)
  const [sheetProjects, setSheetProjects] = useState<SheetProjectInfo[] | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const sheetFileRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    if (!desktop) return
    const [docs, sheets] = await Promise.all([desktop.listProjects(), desktop.listSheetProjects()])
    setProjects(docs)
    setSheetProjects(sheets)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Migration : le classeur de la première version du module Tableur vivait
  // dans localStorage — le convertir une fois en vrai projet.
  const migratedRef = useRef(false)
  useEffect(() => {
    if (!desktop || migratedRef.current) return
    migratedRef.current = true
    const raw = localStorage.getItem('wstudio.sheets.doc')
    if (!raw) return
    const name = localStorage.getItem('wstudio.sheets.name')
    localStorage.removeItem('wstudio.sheets.doc')
    localStorage.removeItem('wstudio.sheets.name')
    try {
      const data = JSON.parse(raw) as XsSheet[]
      if (!Array.isArray(data) || !data.some(sheetHasContent)) return
      void desktop.createSheetProject({ name: name || 'Classeur récupéré', data }).then(refresh)
    } catch {
      /* classeur illisible : abandonné */
    }
  }, [refresh])

  useEffect(() => {
    if (createSignal > 0) setShowNew(true)
  }, [createSignal])

  useEffect(() => {
    if (showNew) inputRef.current?.focus()
  }, [showNew])

  const createProject = useCallback(async () => {
    if (!desktop || !newName.trim() || busy) return
    setBusy(true)
    try {
      if (section === 'sheets') {
        const project = await desktop.createSheetProject({ name: newName.trim() })
        onOpenSheetProject(project)
      } else {
        const project = await desktop.createProject({ name: newName.trim() })
        onOpenProject(project)
      }
    } finally {
      setBusy(false)
      setShowNew(false)
      setNewName('')
    }
  }, [newName, busy, section, onOpenProject, onOpenSheetProject])

  const openProject = useCallback(
    async (info: ProjectInfo) => {
      if (!desktop) return
      const project = await desktop.openProject(info.path)
      if (project) onOpenProject(project)
    },
    [onOpenProject]
  )

  const openSheetProject = useCallback(
    async (info: SheetProjectInfo) => {
      if (!desktop) return
      const project = await desktop.openSheetProject(info.path)
      if (project) onOpenSheetProject(project)
    },
    [onOpenSheetProject]
  )

  const createTempProject = useCallback(async () => {
    if (!desktop || busy) return
    setBusy(true)
    try {
      if (section === 'sheets') {
        const project = await desktop.createSheetProject({ name: 'Brouillon', temporary: true })
        onOpenSheetProject(project)
      } else {
        const project = await desktop.createProject({ name: 'Brouillon', temporary: true })
        onOpenProject(project)
      }
    } finally {
      setBusy(false)
    }
  }, [busy, section, onOpenProject, onOpenSheetProject])

  const importDocument = useCallback(async () => {
    if (!desktop || busy) return
    const file = await desktop.openMarkdown()
    if (!file) return
    setBusy(true)
    try {
      const base = file.path.replace(/^.*[\\/]/, '').replace(/\.(md|markdown|txt)$/i, '')
      const project = await desktop.createProject({ name: base, markdown: file.content })
      onOpenProject(project)
    } finally {
      setBusy(false)
    }
  }, [busy, onOpenProject])

  const importWorkbook = useCallback(
    async (f: File) => {
      if (!desktop || busy) return
      setBusy(true)
      try {
        const wb = await readWorkbookFile(f)
        const data = workbookToSheets(wb)
        if (data.length === 0) throw new Error('classeur vide')
        const base = f.name.replace(/\.(xlsx|xlsm|xls|csv)$/i, '')
        const project = await desktop.createSheetProject({ name: base, data })
        onOpenSheetProject(project)
      } catch {
        window.alert(
          `« ${f.name} » n'a pas pu être lu : est-ce bien un fichier Excel (.xlsx, .xls) ou CSV valide ?`
        )
      } finally {
        setBusy(false)
      }
    },
    [busy, onOpenSheetProject]
  )

  const deleteAnyProject = useCallback(
    async (e: React.MouseEvent, info: { path: string }) => {
      e.stopPropagation()
      if (!desktop) return
      if (await desktop.deleteProject(info.path)) void refresh()
    },
    [refresh]
  )

  const revealProject = useCallback((e: React.MouseEvent, info: { path: string }) => {
    e.stopPropagation()
    void desktop?.revealProject(info.path)
  }, [])

  const modules: {
    id: string
    icon: IconName
    label: string
    desc: string
    hint: string
    active?: boolean
    onClick?: () => void
  }[] = [
    {
      id: 'doc',
      icon: 'file-text',
      label: 'Documents',
      desc: 'Rapports Markdown',
      hint: 'Rédiger des rapports Markdown : aperçu paginé fidèle et export PDF direct',
      active: section === 'docs',
      onClick: () => setSection('docs'),
    },
    {
      id: 'sheets',
      icon: 'grid',
      label: 'Tableur',
      desc: 'Feuilles de calcul',
      hint: 'Feuilles de calcul type tableur : grille, formules, feuilles multiples, import Excel (.xlsx, .xls) et CSV, export xlsx/csv',
      active: section === 'sheets',
      onClick: () => setSection('sheets'),
    },
    {
      id: 'paint',
      icon: 'pencil',
      label: 'Paint',
      desc: 'Dessins & schémas',
      hint: 'Dessins et schémas à main levée : formes, flèches, lissage automatique du trait, export PNG',
      onClick: onOpenPaint,
    },
    {
      id: 'pdfedit',
      icon: 'type',
      label: 'Éditeur PDF',
      desc: 'Modifier un PDF',
      hint: "Modifier le texte d'un PDF existant : importer, cliquer sur un texte pour le remplacer ou l'effacer, exporter la copie modifiée",
      onClick: onOpenPdfEdit,
    },
    {
      id: 'pdftools',
      icon: 'layers',
      label: 'Outils PDF',
      desc: 'Fusion & compression',
      hint: 'Fusionner plusieurs PDF (réorganisation avec aperçu) ou compresser un PDF',
      onClick: onOpenPdfTools,
    },
  ]

  return (
    <div className="home">
      <aside className="home-nav">
        <div className="home-nav-brand">
          <span className="home-nav-logo">
            <img src={logoUrl} alt="" draggable={false} />
          </span>
          <span className="home-nav-wordmark">
            <span className="home-nav-name">
              W<span>Studio</span>
            </span>
            <span className="home-nav-sub">Studio de documents</span>
          </span>
        </div>

        <nav className="home-nav-list" aria-label="Modules">
          <p className="home-nav-label">Modules</p>
          {modules.map((m) => (
            <button
              key={m.id}
              className={`home-nav-item${m.active ? ' is-active' : ''}`}
              onClick={m.onClick}
              aria-current={m.active ? 'page' : undefined}
              title={m.hint}
            >
              <span className="home-nav-icon">
                <Icon name={m.icon} size={17} />
              </span>
              <span className="home-nav-text">
                <span className="home-nav-item-label">{m.label}</span>
                <span className="home-nav-item-desc">{m.desc}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="home-nav-foot">
          <button
            className="home-nav-item home-nav-item-plain"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
          >
            <span className="home-nav-icon">
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
            </span>
            <span className="home-nav-text">
              <span className="home-nav-item-label">
                {theme === 'dark' ? 'Thème clair' : 'Thème sombre'}
              </span>
            </span>
          </button>
        </div>
      </aside>

      <div className="home-main">
        <div className="home-inner">
          <header className="home-hero">
            <h1 className="home-title">{section === 'sheets' ? 'Tableur' : 'Documents'}</h1>
            <p className="home-tagline">Writer Studio</p>
            <div className="home-actions">
              <button className="btn-primary home-btn" onClick={() => setShowNew(true)}>
                <Icon name="plus" />
                {section === 'sheets' ? 'Nouveau tableur' : 'Nouveau projet'}
              </button>
              <button
                className="btn home-btn"
                onClick={() => {
                  if (section === 'sheets') sheetFileRef.current?.click()
                  else void importDocument()
                }}
              >
                <Icon name="folder-open" />
                {section === 'sheets' ? 'Importer un classeur…' : 'Importer un document…'}
              </button>
              <button
                className="btn home-btn"
                onClick={() => void createTempProject()}
                title="Pour essayer ou produire vite : créé dans le dossier temporaire de Windows, rien n'est conservé dans vos documents"
              >
                <Icon name="clock" />
                {section === 'sheets' ? 'Tableur temporaire' : 'Projet temporaire'}
              </button>
            </div>
          </header>

          <section className="home-projects">
            <h2 className="home-section-title">
              <Icon name="clock" size={14} />
              {section === 'sheets' ? 'Tableurs récents' : 'Projets récents'}
              <span className="home-root-hint">Documents\WStudio</span>
            </h2>

            {section === 'docs' &&
              (projects === null ? null : projects.length === 0 ? (
                <div className="home-empty">
                  <p>Aucun projet pour le moment.</p>
                  <p className="hint">
                    Créez votre premier projet : tout ce que vous écrirez y sera enregistré
                    automatiquement.
                  </p>
                </div>
              ) : (
                <div className="project-grid">
                  {projects.map((p) => (
                    <button
                      key={p.path}
                      className="project-card"
                      onClick={() => void openProject(p)}
                    >
                      <DocThumb excerpt={p.excerpt ?? ''} path={p.path} />
                      <span className="project-card-head">
                        <span className="project-card-name">{p.name}</span>
                        <span className="project-card-tools">
                          <span
                            role="button"
                            tabIndex={0}
                            className="project-tool"
                            title="Ouvrir le dossier"
                            onClick={(e) => revealProject(e, p)}
                          >
                            <Icon name="folder" size={14} />
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            className="project-tool project-tool-danger"
                            title="Supprimer (corbeille)"
                            onClick={(e) => void deleteAnyProject(e, p)}
                          >
                            <Icon name="trash" size={14} />
                          </span>
                        </span>
                      </span>
                      {p.title && p.title !== p.name && (
                        <span className="project-card-title">{p.title}</span>
                      )}
                      <span className="project-card-meta">
                        <span>{relativeDate(p.updatedAt)}</span>
                        <span>·</span>
                        <span>{p.words.toLocaleString('fr-FR')} mots</span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}

            {section === 'sheets' &&
              (sheetProjects === null ? null : sheetProjects.length === 0 ? (
                <div className="home-empty">
                  <p>Aucun tableur pour le moment.</p>
                  <p className="hint">
                    Créez votre premier tableur ou importez un fichier Excel (.xlsx, .xls) ou
                    CSV : tout est enregistré automatiquement.
                  </p>
                </div>
              ) : (
                <div className="project-grid">
                  {sheetProjects.map((p) => (
                    <button
                      key={p.path}
                      className="project-card"
                      onClick={() => void openSheetProject(p)}
                    >
                      <SheetThumb preview={p.preview} />
                      <span className="project-card-head">
                        <span className="project-card-name">{p.name}</span>
                        <span className="project-card-tools">
                          <span
                            role="button"
                            tabIndex={0}
                            className="project-tool"
                            title="Ouvrir le dossier"
                            onClick={(e) => revealProject(e, p)}
                          >
                            <Icon name="folder" size={14} />
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            className="project-tool project-tool-danger"
                            title="Supprimer (corbeille)"
                            onClick={(e) => void deleteAnyProject(e, p)}
                          >
                            <Icon name="trash" size={14} />
                          </span>
                        </span>
                      </span>
                      <span className="project-card-meta">
                        <span>{relativeDate(p.updatedAt)}</span>
                        <span>·</span>
                        <span>
                          {p.sheets} feuille{p.sheets > 1 ? 's' : ''}
                        </span>
                        <span>·</span>
                        <span>
                          {p.cells.toLocaleString('fr-FR')} cellule{p.cells > 1 ? 's' : ''}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
          </section>
        </div>
      </div>

      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal modal-small" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>
                <Icon name="plus" size={18} />
                {section === 'sheets' ? 'Nouveau tableur' : 'Nouveau projet'}
              </h2>
              <button className="tb-btn" onClick={() => setShowNew(false)} title="Fermer">
                <Icon name="x" />
              </button>
            </div>
            <div className="modal-body">
              <label className="field">
                <span>{section === 'sheets' ? 'Nom du tableur' : 'Nom du projet'}</span>
                <input
                  ref={inputRef}
                  type="text"
                  value={newName}
                  placeholder={
                    section === 'sheets' ? 'Ex. : Budget 2026' : "Ex. : Rapport d'audit 2026"
                  }
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void createProject()
                    if (e.key === 'Escape') setShowNew(false)
                  }}
                />
              </label>
              <p className="hint">
                {section === 'sheets' ? 'Le tableur' : 'Le projet'} sera enregistré dans{' '}
                <code>Documents\WStudio\{newName.trim() || '…'}</code> et sauvegardé
                automatiquement à chaque modification.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setShowNew(false)}>
                Annuler
              </button>
              <button
                className="btn-primary"
                disabled={!newName.trim() || busy}
                onClick={() => void createProject()}
              >
                <Icon name="plus" />
                {section === 'sheets' ? 'Créer le tableur' : 'Créer le projet'}
              </button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={sheetFileRef}
        type="file"
        accept=".xlsx,.xlsm,.xls,.csv"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void importWorkbook(f)
        }}
      />
    </div>
  )
}
