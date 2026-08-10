import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './Icons'
import { desktop, type AiConfigInfo, type AiRunRequest } from '../lib/desktop'
import { resolveEdits, type AiProposal } from '../lib/ai'
import { AiSettingsModal } from './AiSettingsModal'
import type { EditorMode } from '../types'

interface Props {
  mode: EditorMode
  /** Longueur (caractères) de la sélection courante de l'éditeur Markdown. */
  selectionChars: number
  /** Sélection courante, ou null si vide / hors mode Markdown. */
  getSelection: () => { from: number; to: number; text: string } | null
  /** Markdown complet du document. */
  getMarkdown: () => string
  /** Une proposition est prête : ouvrir la revue accepter/refuser. */
  onProposal: (proposal: AiProposal) => void
  onClose: () => void
}

type Busy = { requestId: string; label: string } | null

export function AiPanel({
  mode,
  selectionChars,
  getSelection,
  getMarkdown,
  onProposal,
  onClose,
}: Props) {
  const [config, setConfig] = useState<AiConfigInfo | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [agentInstruction, setAgentInstruction] = useState('')
  const [busy, setBusy] = useState<Busy>(null)
  const [preview, setPreview] = useState('')
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)

  // Configuration au montage
  useEffect(() => {
    void desktop?.aiGetConfig().then(setConfig)
  }, [])

  // Flux de progression de la requête en cours
  const busyRef = useRef<Busy>(null)
  busyRef.current = busy
  useEffect(
    () =>
      desktop?.onAiProgress(({ requestId, delta }) => {
        if (busyRef.current?.requestId !== requestId) return
        setPreview((p) => (p + delta).slice(-600))
      }),
    []
  )

  const activeProfile = config?.profiles.find((p) => p.id === config.activeProfileId) ?? null

  const selectProfile = useCallback(async (id: string) => {
    if (!desktop) return
    setConfig(await desktop.aiSetActiveProfile(id))
  }, [])

  const runAgent = useCallback(
    async (document: string, agentTask: string) => {
      if (!desktop) return
      const requestId = crypto.randomUUID()
      setNotice(null)
      setPreview('')
      setBusy({ requestId, label: 'Analyse du document par l’agent…' })
      try {
        const result = await desktop.aiRun({
          requestId,
          kind: 'agent',
          document,
          instruction: agentTask,
        })
        if (!result.ok) {
          if (!result.canceled) setNotice({ kind: 'error', text: result.error })
          return
        }
        const { resolved, dropped } = resolveEdits(result.edits ?? [], document)
        if (resolved.length === 0) {
          setNotice(
            dropped > 0
              ? {
                  kind: 'error',
                  text: `Les ${dropped} modification${dropped > 1 ? 's' : ''} proposée${dropped > 1 ? 's' : ''} n'ont pas pu être localisées dans le document (citations inexactes) : rien n'a été appliqué. Réessayez, ou utilisez un modèle plus capable.`,
                }
              : { kind: 'info', text: "L'agent n'a proposé aucune modification." }
          )
          return
        }
        if (dropped > 0) {
          setNotice({
            kind: 'info',
            text: `${dropped} modification${dropped > 1 ? 's' : ''} mal localisée${dropped > 1 ? 's' : ''} ${dropped > 1 ? 'ont été écartées' : 'a été écartée'} par sécurité.`,
          })
        }
        onProposal({ kind: 'document', baseline: document, edits: resolved })
      } finally {
        setBusy(null)
        setPreview('')
      }
    },
    [onProposal]
  )

  const runOnSelection = useCallback(
    async (kind: 'correct' | 'rewrite' | 'custom', label: string) => {
      const sel = getSelection()
      if (!sel || !sel.text.trim() || !desktop) return
      const requestId = crypto.randomUUID()
      setNotice(null)
      setPreview('')
      setBusy({ requestId, label })
      try {
        const req: AiRunRequest =
          kind === 'custom'
            ? { requestId, kind, text: sel.text, instruction: instruction.trim() }
            : { requestId, kind, text: sel.text }
        const result = await desktop.aiRun(req)
        if (!result.ok) {
          if (!result.canceled) setNotice({ kind: 'error', text: result.error })
          return
        }
        // Le modèle termine parfois par un saut de ligne absent de l'original
        let proposed = result.text ?? ''
        if (!sel.text.endsWith('\n')) proposed = proposed.replace(/\n+$/, '')
        if (proposed === sel.text) {
          setNotice({ kind: 'info', text: 'Aucune modification nécessaire : le texte est déjà correct.' })
          return
        }
        onProposal({ kind: 'selection', from: sel.from, to: sel.to, original: sel.text, proposed })
      } finally {
        setBusy(null)
        setPreview('')
      }
    },
    [getSelection, instruction, onProposal]
  )

  const cancel = useCallback(() => {
    if (busy) desktop?.aiCancel(busy.requestId)
  }, [busy])

  if (!desktop) {
    return (
      <aside className="settings-panel ai-panel">
        <div className="settings-head">
          <h2>
            <Icon name="sparkles" />
            Assistant IA
          </h2>
          <button className="tb-btn" onClick={onClose} title="Fermer">
            <Icon name="x" />
          </button>
        </div>
        <section>
          <p className="hint">L'assistant IA est disponible dans l'application de bureau WStudio.</p>
        </section>
      </aside>
    )
  }

  const ready = Boolean(activeProfile?.hasKey)
  const selectionReady = mode === 'markdown' && selectionChars > 0
  const canRun = ready && !busy

  return (
    <aside className="settings-panel ai-panel">
      <div className="settings-head">
        <h2>
          <Icon name="sparkles" />
          Assistant IA
        </h2>
        <button className="tb-btn" onClick={onClose} title="Fermer">
          <Icon name="x" />
        </button>
      </div>

      <section>
        <h3>Modèle</h3>
        {config && config.profiles.length > 0 ? (
          <div className="ai-model-row">
            <select
              value={config.activeProfileId ?? ''}
              onChange={(e) => void selectProfile(e.target.value)}
              disabled={Boolean(busy)}
              title={activeProfile ? `${activeProfile.model}` : undefined}
            >
              {config.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              className="btn-small"
              onClick={() => setShowSettings(true)}
              title="Gérer les modèles (fournisseurs, clés API…)"
            >
              <Icon name="sliders" size={12} />
              Gérer
            </button>
          </div>
        ) : (
          <>
            <p className="hint">
              Aucun modèle configuré. Ajoutez un fournisseur (Anthropic, OpenAI, OpenRouter,
              Groq…) avec sa clé API.
            </p>
            <button className="btn-primary" onClick={() => setShowSettings(true)}>
              <Icon name="plus" />
              Configurer un modèle…
            </button>
          </>
        )}
        {activeProfile && !activeProfile.hasKey && (
          <p className="ai-error">
            Clé API manquante pour « {activeProfile.name} » — modifiez ce profil via « Gérer ».
          </p>
        )}
      </section>

      <section>
        <h3>Sélection</h3>
        {mode !== 'markdown' ? (
          <p className="hint">
            Les actions sur sélection sont disponibles en mode Markdown (Ctrl+1). L'agent
            ci-dessous fonctionne dans les deux modes.
          </p>
        ) : (
          <p className="hint">
            {selectionReady
              ? `${selectionChars.toLocaleString('fr-FR')} caractère${selectionChars > 1 ? 's' : ''} sélectionné${selectionChars > 1 ? 's' : ''} — chaque proposition est revue avant application.`
              : "Sélectionnez du texte dans l'éditeur pour le corriger ou le reformuler."}
          </p>
        )}
        <div className="ai-actions">
          <button
            className="btn"
            disabled={!canRun || !selectionReady}
            onClick={() => void runOnSelection('correct', 'Correction orthographique…')}
          >
            <Icon name="check" />
            Corriger l'orthographe
          </button>
          <button
            className="btn"
            disabled={!canRun || !selectionReady}
            onClick={() => void runOnSelection('rewrite', 'Reformulation professionnelle…')}
          >
            <Icon name="pencil" />
            Reformulation professionnelle
          </button>
        </div>
        <label className="field">
          <span>Consigne libre sur la sélection</span>
          <input
            type="text"
            value={instruction}
            placeholder="Ex. : raccourcir de moitié, passer au passé…"
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canRun && selectionReady && instruction.trim())
                void runOnSelection('custom', 'Application de la consigne…')
            }}
          />
        </label>
        <button
          className="btn"
          disabled={!canRun || !selectionReady || !instruction.trim()}
          onClick={() => void runOnSelection('custom', 'Application de la consigne…')}
        >
          <Icon name="replace" />
          Appliquer à la sélection
        </button>
      </section>

      <section>
        <h3>Agent — document entier</h3>
        <p className="hint">
          L'agent lit tout le document, prend le contexte et ne propose que les modifications
          nécessaires, ligne par ligne. Vous acceptez ou refusez chaque changement.
        </p>
        <label className="field">
          <span>Consigne pour l'agent</span>
          <textarea
            className="ai-textarea"
            rows={3}
            value={agentInstruction}
            placeholder="Ex. : corriger toutes les fautes du document, harmoniser la numérotation des sections, uniformiser la terminologie…"
            onChange={(e) => setAgentInstruction(e.target.value)}
          />
        </label>
        <button
          className="btn-primary"
          disabled={!canRun || !agentInstruction.trim()}
          onClick={() => void runAgent(getMarkdown(), agentInstruction.trim())}
        >
          <Icon name="sparkles" />
          Lancer l'agent
        </button>
      </section>

      {busy && (
        <section className="ai-busy">
          <div className="ai-busy-head">
            <span className="save-spinner" />
            <span>{busy.label}</span>
            <button className="btn-small" onClick={cancel}>
              Annuler
            </button>
          </div>
          {preview && <pre className="ai-preview">{preview}</pre>}
        </section>
      )}

      {notice && <p className={notice.kind === 'error' ? 'ai-error' : 'ai-info'}>{notice.text}</p>}

      {showSettings && config && (
        <AiSettingsModal
          config={config}
          onChange={setConfig}
          onClose={() => setShowSettings(false)}
        />
      )}
    </aside>
  )
}
