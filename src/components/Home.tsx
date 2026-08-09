import { useCallback, useEffect, useRef, useState } from 'react'
import { desktop, type ProjectData, type ProjectInfo } from '../lib/desktop'
import { Icon } from './Icons'

interface Props {
  onOpenProject: (project: ProjectData) => void
  /** Incrémenté par le menu « Nouveau projet » pour ouvrir la boîte de création. */
  createSignal: number
}

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

export function Home({ onOpenProject, createSignal }: Props) {
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    if (!desktop) return
    setProjects(await desktop.listProjects())
  }, [])

  useEffect(() => {
    void refresh()
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
      const project = await desktop.createProject({ name: newName.trim() })
      onOpenProject(project)
    } finally {
      setBusy(false)
      setShowNew(false)
      setNewName('')
    }
  }, [newName, busy, onOpenProject])

  const openProject = useCallback(
    async (info: ProjectInfo) => {
      if (!desktop) return
      const project = await desktop.openProject(info.path)
      if (project) onOpenProject(project)
    },
    [onOpenProject]
  )

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

  const deleteProject = useCallback(
    async (e: React.MouseEvent, info: ProjectInfo) => {
      e.stopPropagation()
      if (!desktop) return
      if (await desktop.deleteProject(info.path)) void refresh()
    },
    [refresh]
  )

  const revealProject = useCallback((e: React.MouseEvent, info: ProjectInfo) => {
    e.stopPropagation()
    void desktop?.revealProject(info.path)
  }, [])

  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-hero">
          <div className="home-mark">
            <Icon name="file-text" size={26} strokeWidth={2} />
          </div>
          <h1 className="home-title">
            W<span>Studio</span>
          </h1>
          <p className="home-tagline">
            Rapports Markdown professionnels — aperçu paginé fidèle, export PDF direct.
          </p>
          <div className="home-actions">
            <button className="btn-primary home-btn" onClick={() => setShowNew(true)}>
              <Icon name="plus" />
              Nouveau projet
            </button>
            <button className="btn home-btn" onClick={importDocument}>
              <Icon name="folder-open" />
              Importer un document…
            </button>
          </div>
        </header>

        <section className="home-projects">
          <h2 className="home-section-title">
            <Icon name="clock" size={14} />
            Projets récents
            <span className="home-root-hint">Documents\WStudio</span>
          </h2>

          {projects === null ? null : projects.length === 0 ? (
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
                <button key={p.path} className="project-card" onClick={() => void openProject(p)}>
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
                        onClick={(e) => void deleteProject(e, p)}
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
          )}
        </section>
      </div>

      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal modal-small" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>
                <Icon name="plus" size={18} />
                Nouveau projet
              </h2>
              <button className="tb-btn" onClick={() => setShowNew(false)} title="Fermer">
                <Icon name="x" />
              </button>
            </div>
            <div className="modal-body">
              <label className="field">
                <span>Nom du projet</span>
                <input
                  ref={inputRef}
                  type="text"
                  value={newName}
                  placeholder="Ex. : Rapport d'audit 2026"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void createProject()
                    if (e.key === 'Escape') setShowNew(false)
                  }}
                />
              </label>
              <p className="hint">
                Le projet sera enregistré dans{' '}
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
                Créer le projet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
