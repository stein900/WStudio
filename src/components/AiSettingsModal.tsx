import { useState } from 'react'
import { Icon } from './Icons'
import { desktop, type AiConfigInfo, type AiProfile } from '../lib/desktop'
import { AI_PRESETS, presetForProfile, type AiProviderPreset } from '../lib/ai'

interface Props {
  config: AiConfigInfo
  /** Configuration mise à jour après création/modification/suppression. */
  onChange: (config: AiConfigInfo) => void
  onClose: () => void
}

interface FormState {
  id?: string
  presetId: string
  name: string
  baseUrl: string
  model: string
  apiKey: string
  hasKey: boolean
}

function emptyForm(preset: AiProviderPreset): FormState {
  return {
    presetId: preset.id,
    name: '',
    baseUrl: preset.baseUrl,
    model: preset.defaultModel ?? '',
    apiKey: '',
    hasKey: false,
  }
}

function formFromProfile(p: AiProfile): FormState {
  return {
    id: p.id,
    presetId: presetForProfile(p.api, p.baseUrl).id,
    name: p.name,
    baseUrl: p.baseUrl,
    model: p.model,
    apiKey: '',
    hasKey: p.hasKey,
  }
}

/** Gestion des profils de modèles IA : liste, création, modification. */
export function AiSettingsModal({ config, onChange, onClose }: Props) {
  const [form, setForm] = useState<FormState | null>(
    config.profiles.length === 0 ? emptyForm(AI_PRESETS[0]) : null
  )
  const [saving, setSaving] = useState(false)

  const preset = AI_PRESETS.find((p) => p.id === form?.presetId) ?? AI_PRESETS[0]

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f))

  const pickPreset = (presetId: string) => {
    const next = AI_PRESETS.find((p) => p.id === presetId) ?? AI_PRESETS[0]
    setForm((f) =>
      f
        ? {
            ...f,
            presetId,
            baseUrl: next.baseUrl,
            model: f.model || (next.defaultModel ?? ''),
          }
        : f
    )
  }

  const canSave = Boolean(
    form &&
      form.model.trim() &&
      (form.apiKey.trim() || form.hasKey) &&
      (preset.api === 'anthropic' || form.baseUrl.trim())
  )

  const save = async () => {
    if (!desktop || !form || !canSave) return
    setSaving(true)
    try {
      const next = await desktop.aiSaveProfile({
        id: form.id,
        name: form.name.trim() || `${preset.label} — ${form.model.trim()}`,
        api: preset.api,
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim(),
        apiKey: form.apiKey.trim() || undefined,
      })
      onChange(next)
      setForm(null)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (p: AiProfile) => {
    if (!desktop) return
    if (!window.confirm(`Supprimer le modèle « ${p.name} » ? Sa clé API sera effacée.`)) return
    onChange(await desktop.aiDeleteProfile(p.id))
  }

  const activate = async (id: string) => {
    if (!desktop) return
    onChange(await desktop.aiSetActiveProfile(id))
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal ai-settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>
              <Icon name="sliders" size={18} />
              Modèles IA
            </h2>
            <p className="hint">
              Configurez un ou plusieurs modèles (Anthropic, OpenAI, OpenRouter, Groq, serveur
              local…). Les clés API sont chiffrées et conservées sur cet ordinateur uniquement.
            </p>
          </div>
          <button className="tb-btn" onClick={onClose} title="Fermer">
            <Icon name="x" />
          </button>
        </div>

        {form === null ? (
          <>
            <div className="ai-profile-list">
              {config.profiles.map((p) => (
                <div
                  key={p.id}
                  className={`ai-profile ${p.id === config.activeProfileId ? 'is-active' : ''}`}
                >
                  <button
                    className="ai-profile-pick"
                    title={p.id === config.activeProfileId ? 'Modèle actif' : 'Utiliser ce modèle'}
                    onClick={() => void activate(p.id)}
                  >
                    <span className="ai-profile-radio" />
                    <span className="ai-profile-texts">
                      <span className="ai-profile-name">{p.name}</span>
                      <span className="ai-profile-meta">
                        {presetForProfile(p.api, p.baseUrl).label} · {p.model}
                        {!p.hasKey && ' · clé API manquante'}
                      </span>
                    </span>
                  </button>
                  <button
                    className="btn-small"
                    onClick={() => setForm(formFromProfile(p))}
                    title="Modifier ce profil"
                  >
                    <Icon name="pencil" size={12} />
                    Modifier
                  </button>
                  <button className="btn-small" onClick={() => void remove(p)} title="Supprimer">
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              ))}
              {config.profiles.length === 0 && (
                <p className="hint">Aucun modèle configuré pour l'instant.</p>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setForm(emptyForm(AI_PRESETS[0]))}>
                <Icon name="plus" />
                Ajouter un modèle
              </button>
              <button className="btn-primary" onClick={onClose}>
                Fermer
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="ai-profile-form">
              <label className="field">
                <span>Fournisseur</span>
                <select value={form.presetId} onChange={(e) => pickPreset(e.target.value)}>
                  {AI_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Nom du profil</span>
                <input
                  type="text"
                  value={form.name}
                  placeholder={`Ex. : ${preset.label} — ${form.model || preset.modelPlaceholder}`}
                  onChange={(e) => set('name', e.target.value)}
                />
              </label>
              <label className="field">
                <span>
                  URL de base{preset.api === 'anthropic' ? ' (optionnelle)' : ''}
                </span>
                <input
                  type="text"
                  value={form.baseUrl}
                  placeholder={
                    preset.api === 'anthropic'
                      ? 'https://api.anthropic.com (défaut)'
                      : 'https://…/v1'
                  }
                  onChange={(e) => set('baseUrl', e.target.value)}
                />
              </label>
              <label className="field">
                <span>Identifiant du modèle</span>
                <input
                  type="text"
                  value={form.model}
                  placeholder={preset.modelPlaceholder}
                  onChange={(e) => set('model', e.target.value)}
                />
              </label>
              <label className="field">
                <span>Clé API</span>
                <input
                  type="password"
                  value={form.apiKey}
                  autoComplete="off"
                  placeholder={form.hasKey ? '•••••••• (laisser vide pour conserver)' : 'Clé du fournisseur'}
                  onChange={(e) => set('apiKey', e.target.value)}
                />
              </label>
              <p className="hint">{preset.keyHint}</p>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setForm(null)} disabled={saving}>
                Retour
              </button>
              <button className="btn-primary" disabled={!canSave || saving} onClick={() => void save()}>
                <Icon name="check" />
                {form.id ? 'Enregistrer les modifications' : 'Ajouter ce modèle'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
