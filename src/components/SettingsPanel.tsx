import { Icon } from './Icons'
import type { PageSettings } from '../types'

interface Props {
  settings: PageSettings
  onChange: (settings: PageSettings) => void
  onClose: () => void
}

export function SettingsPanel({ settings, onChange, onClose }: Props) {
  const set = <K extends keyof PageSettings>(key: K, value: PageSettings[K]) =>
    onChange({ ...settings, [key]: value })

  const onLogoPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => set('headerLogo', reader.result as string)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <aside className="settings-panel">
      <div className="settings-head">
        <h2>
          <Icon name="sliders" />
          Mise en page
        </h2>
        <button className="tb-btn" onClick={onClose} title="Fermer">
          <Icon name="x" />
        </button>
      </div>

      <section>
        <h3>En-tête</h3>
        <label className="field">
          <span>Texte d'en-tête</span>
          <input
            type="text"
            value={settings.headerText}
            placeholder="Ex. : Rapport technique — Confidentiel"
            onChange={(e) => set('headerText', e.target.value)}
          />
        </label>
        <div className="field">
          <span>Logo</span>
          {settings.headerLogo ? (
            <div className="logo-row">
              <img src={settings.headerLogo} alt="Logo" className="logo-preview" />
              <button className="btn-small" onClick={() => set('headerLogo', null)}>
                Retirer
              </button>
            </div>
          ) : (
            <input type="file" accept="image/*" onChange={onLogoPicked} />
          )}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.headerOnFirstPage}
            onChange={(e) => set('headerOnFirstPage', e.target.checked)}
          />
          <span>Afficher l'en-tête sur la première page</span>
        </label>
      </section>

      <section>
        <h3>Pied de page</h3>
        <label className="field">
          <span>Texte de pied de page</span>
          <input
            type="text"
            value={settings.footerText}
            placeholder="Ex. : © 2026 Mon entreprise — Diffusion restreinte"
            onChange={(e) => set('footerText', e.target.value)}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.pageNumbers}
            onChange={(e) => set('pageNumbers', e.target.checked)}
          />
          <span>Numéroter les pages (n / total)</span>
        </label>
      </section>

      <section>
        <h3>Document</h3>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.autoToc}
            onChange={(e) => set('autoToc', e.target.checked)}
          />
          <span>Sommaire automatique (avec numéros de page)</span>
        </label>
        <p className="hint">
          Placez la ligne <code>[TOC]</code> dans le document pour choisir l'emplacement du
          sommaire. Sans marqueur, il est inséré après le titre principal.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.h1NewPage}
            onChange={(e) => set('h1NewPage', e.target.checked)}
          />
          <span>Chaque Titre 1 commence sur une nouvelle page</span>
        </label>
        <label className="field">
          <span>Police du corps de texte</span>
          <select
            value={settings.fontFamily}
            onChange={(e) => set('fontFamily', e.target.value as PageSettings['fontFamily'])}
          >
            <option value="sans">Sans-serif (Segoe UI / Helvetica)</option>
            <option value="serif">Serif (Georgia / Times)</option>
          </select>
        </label>
        <label className="field">
          <span>Taille du texte : {settings.fontSize} pt</span>
          <input
            type="range"
            min={9}
            max={13}
            step={0.5}
            value={settings.fontSize}
            onChange={(e) => set('fontSize', Number(e.target.value))}
          />
        </label>
      </section>
    </aside>
  )
}
