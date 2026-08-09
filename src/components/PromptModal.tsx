import { useState } from 'react'
import { Icon } from './Icons'
import { AI_PROMPT } from '../lib/prompt'

interface Props {
  onClose: () => void
}

export function PromptModal({ onClose }: Props) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(AI_PROMPT)
    } catch {
      // Repli si l'API presse-papiers est bloquée
      const ta = document.createElement('textarea')
      ta.value = AI_PROMPT
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal prompt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>
              <Icon name="sparkles" size={18} />
              Prompt pour l'IA rédactrice
            </h2>
            <p className="hint">
              Copiez ce prompt et donnez-le à n'importe quelle IA (avec votre sujet à la fin).
              Elle produira un Markdown conforme aux conventions professionnelles, prêt à coller
              ici puis à exporter en PDF.
            </p>
          </div>
          <button className="tb-btn" onClick={onClose} title="Fermer">
            <Icon name="x" />
          </button>
        </div>
        <pre className="prompt-text">{AI_PROMPT}</pre>
        <div className="modal-foot">
          <button className="btn-primary" onClick={copy}>
            <Icon name={copied ? 'check' : 'copy'} />
            {copied ? 'Copié dans le presse-papiers' : 'Tout copier'}
          </button>
        </div>
      </div>
    </div>
  )
}
