import { useState } from 'react'
import { Icon } from './Icons'
import type { DiffHunk } from '../lib/diff'

interface Props {
  /** Hunks à examiner (coordonnées relatives au texte de référence). */
  hunks: DiffHunk[]
  /** Titre du contexte : « Sélection » ou « Document entier ». */
  scope: string
  /** Nombre de lignes du texte de référence (alerte de suppression massive). */
  baselineLineCount?: number
  onApply: (accepted: boolean[]) => void
  onClose: () => void
}

/** Revue des modifications proposées par l'IA : accepter/refuser hunk par hunk. */
export function AiReviewModal({ hunks, scope, baselineLineCount, onApply, onClose }: Props) {
  const [accepted, setAccepted] = useState<boolean[]>(() => hunks.map(() => true))
  const count = accepted.filter(Boolean).length

  const toggle = (idx: number, value: boolean) =>
    setAccepted((a) => a.map((v, i) => (i === idx ? value : v)))

  // Alerte si la proposition retire une part importante du texte existant
  const removedLines = hunks.reduce((n, h, i) => n + (accepted[i] ? h.oldLines.length : 0), 0)
  const removedShare = baselineLineCount && baselineLineCount >= 10 ? removedLines / baselineLineCount : 0

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal ai-review" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>
              <Icon name="sparkles" size={18} />
              Modifications proposées — {scope}
            </h2>
            <p className="hint">
              {hunks.length} modification{hunks.length > 1 ? 's' : ''} proposée
              {hunks.length > 1 ? 's' : ''}. Rien n'est appliqué avant votre validation.
            </p>
          </div>
          <button className="tb-btn" onClick={onClose} title="Fermer sans appliquer">
            <Icon name="x" />
          </button>
        </div>

        {removedShare > 0.3 && (
          <p className="ai-review-warning">
            Attention : les modifications retenues remplacent ou suppriment{' '}
            {Math.round(removedShare * 100)} % des lignes existantes. Vérifiez soigneusement les
            passages en rouge avant d'appliquer.
          </p>
        )}

        <div className="ai-review-list">
          {hunks.map((h, idx) => (
            <div key={idx} className={`ai-hunk ${accepted[idx] ? '' : 'is-rejected'}`}>
              <div className="ai-hunk-head">
                <span className="ai-hunk-loc">
                  Ligne {h.startOld + 1}
                  {h.oldLines.length > 1 ? `–${h.startOld + h.oldLines.length}` : ''}
                  {h.oldLines.length === 0 ? ' (insertion)' : ''}
                  {h.newLines.length === 0 ? ' (suppression)' : ''}
                </span>
                {h.reason && <span className="ai-hunk-reason">{h.reason}</span>}
                <span className="ai-hunk-toggle">
                  <button
                    className={accepted[idx] ? 'btn-small is-on-accept' : 'btn-small'}
                    onClick={() => toggle(idx, true)}
                  >
                    <Icon name="check" size={12} />
                    Accepter
                  </button>
                  <button
                    className={!accepted[idx] ? 'btn-small is-on-reject' : 'btn-small'}
                    onClick={() => toggle(idx, false)}
                  >
                    <Icon name="x" size={12} />
                    Refuser
                  </button>
                </span>
              </div>
              <div className="ai-hunk-body">
                {h.oldLines.map((line, i) => (
                  <div key={`o${i}`} className="ai-line ai-line-del">
                    <span className="ai-line-sign">−</span>
                    <span className="ai-line-text">{line || ' '}</span>
                  </div>
                ))}
                {h.newLines.map((line, i) => (
                  <div key={`n${i}`} className="ai-line ai-line-add">
                    <span className="ai-line-sign">+</span>
                    <span className="ai-line-text">{line || ' '}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="modal-foot ai-review-foot">
          <span className="ai-review-count">
            {count} / {hunks.length} retenue{count > 1 ? 's' : ''}
          </span>
          <button className="btn" onClick={() => setAccepted(hunks.map(() => true))}>
            Tout accepter
          </button>
          <button className="btn" onClick={() => setAccepted(hunks.map(() => false))}>
            Tout refuser
          </button>
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn-primary" disabled={count === 0} onClick={() => onApply(accepted)}>
            <Icon name="check" />
            Appliquer {count > 0 ? `(${count})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
