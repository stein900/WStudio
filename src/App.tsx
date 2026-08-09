import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { MarkdownEditor } from './components/MarkdownEditor'
import { PagedPreview } from './components/PagedPreview'
import { DocEditor } from './components/DocEditor'
import { SettingsPanel } from './components/SettingsPanel'
import { PromptModal } from './components/PromptModal'
import { AiPanel } from './components/AiPanel'
import { AiReviewModal } from './components/AiReviewModal'
import { proposalBase, proposalHunks, type AiProposal } from './lib/ai'
import { applyHunks } from './lib/diff'
import { Home } from './components/Home'
import { Icon } from './components/Icons'
import { PaintView } from './paint/PaintView'
import { desktop, isDesktop, type ProjectData } from './lib/desktop'
import logoUrl from './assets/wstudio-logo.png'
import { exportToPdf, type PagedAnchors } from './lib/exportPdf'
import { DEFAULT_DOC } from './lib/defaultDoc'
import { DEFAULT_SETTINGS, type EditorMode, type PageSettings } from './types'
import './App.css'

const LS_DOC = 'rapportcreator.doc'
const LS_SETTINGS = 'rapportcreator.settings'
const LS_THEME = 'wstudio.theme'

type Theme = 'light' | 'dark'

function initialTheme(): Theme {
  const saved = localStorage.getItem(LS_THEME)
  if (saved === 'dark' || saved === 'light') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

interface SaveFilePickerWindow extends Window {
  showSaveFilePicker?: (options?: {
    suggestedName?: string
    types?: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<FileSystemFileHandle>
}

function loadSettings(): PageSettings {
  try {
    const raw = localStorage.getItem(LS_SETTINGS)
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    /* paramètres corrompus : repartir des valeurs par défaut */
  }
  return DEFAULT_SETTINGS
}

function documentTitle(markdown: string): string {
  const m = markdown.match(/^#\s+(.+)$/m)
  return m ? m[1].replace(/[*_`#]/g, '').trim() : 'rapport'
}

export default function App() {
  const [markdown, setMarkdown] = useState<string>(
    () => localStorage.getItem(LS_DOC) ?? DEFAULT_DOC
  )
  const [settings, setSettings] = useState<PageSettings>(loadSettings)
  const [mode, setMode] = useState<EditorMode>('markdown')
  const [docKey, setDocKey] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  const [showAi, setShowAi] = useState(false)
  const [aiProposal, setAiProposal] = useState<AiProposal | null>(null)
  const [selectionChars, setSelectionChars] = useState(0)
  const mdViewRef = useRef<EditorView | null>(null)
  const [exporting, setExporting] = useState(false)
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null)
  const filePathRef = useRef<string | null>(null) // chemin natif (application de bureau)
  const [filePath, setFilePath] = useState<string | null>(null)
  const openInputRef = useRef<HTMLInputElement>(null)

  // Projet WStudio courant (application de bureau) et vue active
  const [project, setProject] = useState<{
    name: string
    path: string
    temporary?: boolean
  } | null>(null)
  const [view, setView] = useState<'home' | 'editor' | 'paint'>(isDesktop ? 'home' : 'editor')
  const [createSignal, setCreateSignal] = useState(0)

  // Thème clair/sombre : appliqué sur <html> (les feuilles de style s'y
  // accrochent), mémorisé, système par défaut au premier lancement.
  const [theme, setTheme] = useState<Theme>(initialTheme)
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(LS_THEME, theme)
  }, [theme])
  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])

  // Aperçu fidèle (moteur du PDF) en écran partagé dans le mode Document
  const [docSplit, setDocSplit] = useState(
    () => localStorage.getItem('wstudio.docsplit') === '1'
  )
  useEffect(() => {
    localStorage.setItem('wstudio.docsplit', docSplit ? '1' : '0')
  }, [docSplit])

  // Ancres de coupure mesurées dans le rendu Paged.js (source de vérité du
  // PDF) : le mode Document y asservit ses bandes de page. Alimentées par
  // l'aperçu visible (Markdown ou écran partagé) ou par l'aperçu hors écran
  // monté en mode Document sans écran partagé.
  const [docAnchors, setDocAnchors] = useState<PagedAnchors | null>(null)

  // Sauvegarde automatique locale (repli navigateur, inutile quand un projet est ouvert)
  useEffect(() => {
    if (project) return
    const t = setTimeout(() => localStorage.setItem(LS_DOC, markdown), 400)
    return () => clearTimeout(t)
  }, [markdown, project])

  useEffect(() => {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(settings))
  }, [settings])

  // Sauvegarde du projet : état visible (pastille), débounce 1 s après la
  // dernière frappe + filet périodique 10 s (une frappe continue repousse le
  // débounce indéfiniment — le filet garantit une écriture régulière).
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'saving'>('saved')
  const persistRef = useRef<() => Promise<void>>(async () => {})
  persistRef.current = async () => {
    const d = desktop
    if (!project || !d) return
    setSaveState('saving')
    try {
      await d.saveProject({ path: project.path, markdown, settings })
      setSaveState('saved')
    } catch {
      setSaveState('pending') // réessayé par le filet périodique
    }
  }
  const firstChangeRef = useRef(true)
  useEffect(() => {
    if (!project || !desktop) return
    if (firstChangeRef.current) {
      firstChangeRef.current = false // montage : contenu tout juste chargé
      return
    }
    setSaveState('pending')
    const t = setTimeout(() => void persistRef.current(), 1000)
    return () => clearTimeout(t)
  }, [markdown, settings, project])
  useEffect(() => {
    firstChangeRef.current = true
    setSaveState('saved')
  }, [project])
  useEffect(() => {
    if (!project || !desktop) return
    const iv = setInterval(() => {
      setSaveState((s) => {
        if (s === 'pending') void persistRef.current()
        return s
      })
    }, 10_000)
    return () => clearInterval(iv)
  }, [project])

  // Filet de sécurité : sauvegarde immédiate à la fermeture de la fenêtre
  const flushRef = useRef<() => void>(() => {})
  flushRef.current = () => {
    if (project && desktop) desktop.saveProjectNow({ path: project.path, markdown, settings })
  }
  useEffect(() => {
    const flush = () => flushRef.current()
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  const openProjectData = useCallback(async (p: ProjectData) => {
    // Migration transparente : les images base64 (collages Google Docs…)
    // deviennent des fichiers assets/ — le markdown reste léger.
    let md = p.markdown
    if (desktop && md.includes('data:image/')) {
      try {
        md = (await desktop.extractDataImages({ path: p.path, markdown: md })).markdown
      } catch {
        /* extraction impossible : ouvrir tel quel */
      }
    }
    setProject({ name: p.name, path: p.path, temporary: p.temporary })
    setMarkdown(md)
    setSettings(p.settings ? { ...DEFAULT_SETTINGS, ...p.settings } : DEFAULT_SETTINGS)
    setDocAnchors(null) // ancres de l'ancien document : ne pas synchroniser dessus
    setMode('doc') // l'édition type traitement de texte est le mode principal
    setDocKey((k) => k + 1)
    setView('editor')
  }, [])

  // Même filet en cours d'édition Markdown (collage direct de base64)
  const extractingRef = useRef(false)
  useEffect(() => {
    const d = desktop
    if (!project || !d || mode !== 'markdown') return
    if (!markdown.includes('data:image/') || extractingRef.current) return
    const t = setTimeout(async () => {
      extractingRef.current = true
      try {
        const res = await d.extractDataImages({ path: project.path, markdown })
        if (res.count > 0) {
          setMarkdown(res.markdown)
          setDocKey((k) => k + 1)
        }
      } finally {
        extractingRef.current = false
      }
    }, 900)
    return () => clearTimeout(t)
  }, [markdown, project, mode])

  // -------------------- Assistant IA --------------------
  // Sélection courante de l'éditeur Markdown (base des actions « sélection »)
  const getAiSelection = useCallback(() => {
    const view = mdViewRef.current
    if (mode !== 'markdown' || !view) return null
    const { from, to } = view.state.selection.main
    if (from === to) return null
    return { from, to, text: view.state.sliceDoc(from, to) }
  }, [mode])

  const getAiMarkdown = useCallback(() => markdown, [markdown])

  // Hunks présentés dans la revue accepter/refuser
  const aiHunks = useMemo(() => (aiProposal ? proposalHunks(aiProposal) : []), [aiProposal])

  // Application des hunks acceptés — avec garde anti-écrasement si le
  // document ou la sélection a changé pendant l'appel au modèle.
  const applyAiProposal = useCallback(
    (accepted: boolean[]) => {
      const proposal = aiProposal
      if (!proposal) return
      const result = applyHunks(proposalBase(proposal), aiHunks, accepted)
      if (proposal.kind === 'selection') {
        const view = mdViewRef.current
        if (!view || view.state.sliceDoc(proposal.from, proposal.to) !== proposal.original) {
          window.alert('La sélection a changé depuis la demande : proposition abandonnée.')
        } else {
          view.dispatch({
            changes: { from: proposal.from, to: proposal.to, insert: result },
          })
          view.focus()
        }
      } else if (markdown !== proposal.baseline) {
        window.alert("Le document a été modifié pendant l'analyse : proposition abandonnée.")
      } else if (mode === 'markdown' && mdViewRef.current) {
        // Passer par CodeMirror préserve l'historique d'annulation (Ctrl+Z)
        const view = mdViewRef.current
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: result } })
      } else {
        setMarkdown(result)
        setDocKey((k) => k + 1)
      }
      setAiProposal(null)
    },
    [aiProposal, aiHunks, markdown, mode]
  )

  const goHome = useCallback(() => {
    flushRef.current() // ne rien perdre en quittant l'éditeur
    setProject(null)
    setView('home')
  }, [])

  const switchMode = useCallback((next: EditorMode) => {
    setMode(next)
    if (next === 'doc') setDocKey((k) => k + 1) // remonte l'éditeur avec le Markdown à jour
  }, [])

  const newDocument = useCallback(() => {
    if (!window.confirm('Créer un nouveau document ? Le contenu actuel sera remplacé.')) return
    fileHandleRef.current = null
    filePathRef.current = null
    setFilePath(null)
    setMarkdown('# Nouveau rapport\n\n[TOC]\n\n## 1. Introduction\n\n')
    setDocKey((k) => k + 1)
  }, [])

  const openFile = useCallback(async () => {
    if (desktop) {
      const res = await desktop.openMarkdown()
      if (!res) return
      filePathRef.current = res.path
      setFilePath(res.path)
      setMarkdown(res.content)
      setDocKey((k) => k + 1)
      return
    }
    openInputRef.current?.click()
  }, [])

  const onFileOpened = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setMarkdown(await file.text())
      fileHandleRef.current = null
      setDocKey((k) => k + 1)
    }
    e.target.value = ''
  }, [])

  const saveFile = useCallback(async (forceDialog = false) => {
    const suggested = `${documentTitle(markdown).replace(/[^\wÀ-ſ -]/g, '')}.md`

    if (desktop) {
      const res = await desktop.saveMarkdown({
        path: filePathRef.current,
        content: markdown,
        suggestedName: suggested,
        forceDialog,
      })
      if (res) {
        filePathRef.current = res.path
        setFilePath(res.path)
      }
      return
    }

    const w = window as SaveFilePickerWindow
    if (w.showSaveFilePicker) {
      try {
        const handle =
          fileHandleRef.current ??
          (await w.showSaveFilePicker({
            suggestedName: suggested,
            types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
          }))
        const writable = await handle.createWritable()
        await writable.write(markdown)
        await writable.close()
        fileHandleRef.current = handle
        return
      } catch (err) {
        if ((err as DOMException).name === 'AbortError') return
        // repli téléchargement ci-dessous
      }
    }
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = suggested
    a.click()
    URL.revokeObjectURL(a.href)
  }, [markdown])

  // Export fidèle : en mode Markdown, le PDF est imprimé depuis l'aperçu
  // LUI-MÊME (même DOM déjà paginé → coupures identiques garanties).
  const previewExportIdRef = useRef<(() => number | null) | null>(null)

  const doExport = useCallback(async () => {
    setExporting(true)
    try {
      const wcId = desktop ? previewExportIdRef.current?.() : null
      if (desktop && wcId != null) {
        await desktop.exportPdfFromWebContents({
          webContentsId: wcId,
          suggestedName: `${documentTitle(markdown).replace(/[^\wÀ-ſ -]/g, '')}.pdf`,
        })
        return
      }
      await exportToPdf(markdown, settings, documentTitle(markdown), project?.path)
    } finally {
      setExporting(false)
    }
  }, [markdown, settings, project])

  // Actions du menu applicatif natif (application de bureau)
  const menuHandlers = useRef<Record<string, () => void>>({})
  menuHandlers.current = {
    new: () => {
      goHome()
      setCreateSignal((n) => n + 1)
    },
    home: goHome,
    save: () => {
      if (project) void persistRef.current()
      else void saveFile()
    },
    reveal: () => {
      if (project) void desktop?.revealProject(project.path)
    },
    'export-pdf': () => {
      if (view === 'editor') void doExport()
    },
    'mode-markdown': () => {
      if (view === 'editor') switchMode('markdown')
    },
    'mode-doc': () => {
      if (view === 'editor') switchMode('doc')
    },
    settings: () => {
      if (view === 'editor') {
        setShowAi(false)
        setShowSettings((s) => !s)
      }
    },
    ai: () => {
      if (view === 'editor') {
        setShowSettings(false)
        setShowAi((s) => !s)
      }
    },
    prompt: () => setShowPrompt(true),
  }
  useEffect(() => desktop?.onMenu((action) => menuHandlers.current[action]?.()), [])

  // Titre de la fenêtre : projet ou document courant + nom de l'application
  useEffect(() => {
    if (isDesktop && view === 'home') {
      document.title = 'WStudio'
      return
    }
    if (view === 'paint') {
      document.title = 'Paint — WStudio'
      return
    }
    const name =
      project?.name ??
      (filePath ? filePath.replace(/^.*[\\/]/, '') : documentTitle(markdown))
    document.title = `${name} — WStudio`
  }, [filePath, markdown, project, view])

  const words = useMemo(
    () => (markdown.trim() ? markdown.trim().split(/\s+/).length : 0),
    [markdown]
  )

  if (view === 'paint') {
    return <PaintView onClose={() => setView('home')} />
  }

  if (isDesktop && view === 'home') {
    return (
      <Home
        onOpenProject={openProjectData}
        createSignal={createSignal}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenPaint={() => setView('paint')}
      />
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <img src={logoUrl} alt="" draggable={false} />
          </div>
          <div>
            <div className="brand-name">
              W<span>Studio</span>
            </div>
            <span className="brand-sub">Markdown → PDF professionnel</span>
          </div>
        </div>

        <span className="topbar-divider" />

        {isDesktop ? (
          <div className="topbar-group">
            <button className="btn" onClick={goHome} title="Retour à l'accueil (Ctrl+O)">
              <Icon name="home" />
              Accueil
            </button>
            {project && (
              <button
                className="project-chip"
                title={
                  project.temporary
                    ? `Projet temporaire — ${project.path}`
                    : `Ouvrir le dossier ${project.path}`
                }
                onClick={() => void desktop?.revealProject(project.path)}
              >
                <Icon name={project.temporary ? 'clock' : 'folder'} size={13} />
                {project.name}
              </button>
            )}
            {project && (
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
            )}
          </div>
        ) : (
          <div className="topbar-group">
            <button className="btn" onClick={newDocument}>
              <Icon name="file-plus" />
              Nouveau
            </button>
            <button className="btn" onClick={openFile}>
              <Icon name="folder-open" />
              Ouvrir…
            </button>
            <button className="btn" onClick={() => saveFile()}>
              <Icon name="save" />
              Enregistrer
            </button>
          </div>
        )}

        <div className="mode-switch">
          <button
            className={mode === 'markdown' ? 'is-active' : ''}
            onClick={() => switchMode('markdown')}
            title="Éditeur Markdown avec aperçu en direct"
          >
            <Icon name="hash" size={14} />
            Markdown
          </button>
          <button
            className={mode === 'doc' ? 'is-active' : ''}
            onClick={() => switchMode('doc')}
            title="Édition type traitement de texte (converti en Markdown)"
          >
            <Icon name="file-text" size={14} />
            Document
          </button>
        </div>

        <div className="topbar-group topbar-right">
          <button
            className="btn btn-icon"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          {mode === 'doc' && (
            <button
              className={docSplit ? 'btn btn-accent' : 'btn'}
              title="Afficher les vraies pages du PDF pendant la rédaction"
              onClick={() => setDocSplit((s) => !s)}
            >
              <Icon name="eye" />
              Aperçu fidèle
            </button>
          )}
          {isDesktop && (
            <button
              className={showAi ? 'btn btn-accent' : 'btn'}
              title="Corriger, reformuler ou confier le document à l'agent IA (Ctrl+Maj+A)"
              onClick={() => {
                setShowSettings(false)
                setShowAi((s) => !s)
              }}
            >
              <Icon name="sparkles" />
              Assistant IA
            </button>
          )}
          <button className="btn" onClick={() => setShowPrompt(true)}>
            <Icon name="copy" />
            Prompt IA
          </button>
          <button
            className="btn"
            onClick={() => {
              setShowAi(false)
              setShowSettings((s) => !s)
            }}
          >
            <Icon name="sliders" />
            Mise en page
          </button>
          <button className="btn-primary" onClick={doExport} disabled={exporting}>
            <Icon name="file-down" />
            {exporting ? 'Préparation…' : 'Exporter en PDF'}
          </button>
        </div>
      </header>

      <main className="workspace">
        {mode === 'markdown' ? (
          <div className="split">
            <div className="pane pane-editor">
              <div className="pane-head">
                <span className="pane-head-title">
                  <Icon name="hash" size={13} />
                  Éditeur Markdown
                </span>
                <span className="pane-head-meta">
                  {words.toLocaleString('fr-FR')} mot{words > 1 ? 's' : ''}
                </span>
              </div>
              <div className="pane-body">
                <MarkdownEditor
                  value={markdown}
                  onChange={setMarkdown}
                  dark={theme === 'dark'}
                  viewRef={mdViewRef}
                  onSelectionChange={setSelectionChars}
                />
              </div>
            </div>
            <div className="pane pane-preview">
              <div className="pane-head">
                <span className="pane-head-title">
                  <Icon name="file-text" size={13} />
                  Aperçu PDF
                </span>
                <span className="pane-head-meta">fidèle à l'export</span>
              </div>
              <div className="pane-body">
                <PagedPreview
                  markdown={markdown}
                  settings={settings}
                  title={documentTitle(markdown)}
                  projectPath={project?.path}
                  exportIdRef={previewExportIdRef}
                  onAnchors={setDocAnchors}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="split" style={docSplit ? undefined : { gridTemplateColumns: '1fr' }}>
            <div className="pane pane-editor">
              <DocEditor
                key={`${docKey}-${settings.fontSize}-${settings.fontFamily}-${theme}`}
                initialMarkdown={markdown}
                onChange={setMarkdown}
                settings={settings}
                assetRoot={project?.path}
                anchors={docAnchors}
              />
            </div>
            {docSplit ? (
              <div className="pane pane-preview">
                <div className="pane-head">
                  <span className="pane-head-title">
                    <Icon name="file-text" size={13} />
                    Aperçu PDF
                  </span>
                  <span className="pane-head-meta">pages exactes de l'export</span>
                </div>
                <div className="pane-body">
                  <PagedPreview
                    markdown={markdown}
                    settings={settings}
                    title={documentTitle(markdown)}
                    projectPath={project?.path}
                    exportIdRef={previewExportIdRef}
                    onAnchors={setDocAnchors}
                  />
                </div>
              </div>
            ) : (
              /* Moteur du PDF hors écran : il pagine en continu le document
                 pour fournir les ancres de coupure au mode Document (et sert
                 de source à l'export). Jamais display:none — un webview non
                 rendu cesse de paginer. */
              <div className="paged-offscreen" aria-hidden="true">
                <PagedPreview
                  markdown={markdown}
                  settings={settings}
                  title={documentTitle(markdown)}
                  projectPath={project?.path}
                  exportIdRef={previewExportIdRef}
                  onAnchors={setDocAnchors}
                />
              </div>
            )}
          </div>
        )}
        {showSettings && (
          <SettingsPanel
            settings={settings}
            onChange={setSettings}
            onClose={() => setShowSettings(false)}
          />
        )}
        {showAi && (
          <AiPanel
            mode={mode}
            selectionChars={selectionChars}
            getSelection={getAiSelection}
            getMarkdown={getAiMarkdown}
            onProposal={setAiProposal}
            onClose={() => setShowAi(false)}
          />
        )}
      </main>

      <footer className="statusbar">
        <span>
          {words.toLocaleString('fr-FR')} mot{words > 1 ? 's' : ''}
        </span>
        {!project && filePath && (
          <span className="status-file" title={filePath}>
            {filePath.replace(/^.*[\\/]/, '')}
          </span>
        )}
        <span className="status-hint">
          {mode === 'markdown'
            ? 'Mode Markdown — aperçu en direct à droite'
            : 'Mode Document — tout est converti en Markdown en arrière-plan'}
        </span>
        <span>
          <span className="status-dot" />
          {project
            ? project.temporary
              ? 'Projet temporaire — non conservé dans vos documents'
              : `Enregistré — WStudio\\${project.name}`
            : 'Sauvegarde locale automatique'}
        </span>
      </footer>

      {showPrompt && <PromptModal onClose={() => setShowPrompt(false)} />}
      {aiProposal && (
        <AiReviewModal
          hunks={aiHunks}
          scope={aiProposal.kind === 'selection' ? 'sélection' : 'document entier'}
          baselineLineCount={proposalBase(aiProposal).split('\n').length}
          onApply={applyAiProposal}
          onClose={() => setAiProposal(null)}
        />
      )}
      {exporting && (
        <div className="export-overlay">
          <div className="export-box">
            <div className="spinner" />
            <p>Mise en page du PDF…</p>
            <p className="hint">
              {isDesktop
                ? 'Choisissez l’emplacement du fichier : le PDF sera écrit directement.'
                : 'La boîte d’impression va s’ouvrir : choisissez « Enregistrer au format PDF ».'}
            </p>
          </div>
        </div>
      )}

      <input
        ref={openInputRef}
        type="file"
        accept=".md,.markdown,.txt"
        style={{ display: 'none' }}
        onChange={onFileOpened}
      />
    </div>
  )
}
