/**
 * Assistant IA — logique côté renderer : transformation des réponses du
 * modèle en « propositions » revues par l'utilisateur (diff accepter/refuser).
 * Les appels réseau vivent dans le processus principal (electron/ai.cjs).
 */
import type { AiEdit } from './desktop'
import { diffLines, type DiffHunk } from './diff'

/** Pré-réglage de fournisseur : pré-remplit le formulaire de profil. */
export interface AiProviderPreset {
  id: string
  label: string
  api: 'anthropic' | 'openai'
  baseUrl: string
  /** URL de base modifiable par l'utilisateur (fournisseur « autre »). */
  customUrl?: boolean
  modelPlaceholder: string
  /** Suggestion de modèle insérée par défaut à la création. */
  defaultModel?: string
  keyHint: string
}

/** Fournisseurs proposés à la création d'un profil. */
export const AI_PRESETS: AiProviderPreset[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    api: 'anthropic',
    baseUrl: '',
    modelPlaceholder: 'claude-opus-5',
    defaultModel: 'claude-opus-5',
    keyHint: 'Clé créée sur platform.claude.com (sk-ant-…)',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    api: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    modelPlaceholder: 'gpt-…',
    keyHint: 'Clé créée sur platform.openai.com (sk-…)',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    api: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelPlaceholder: 'anthropic/claude-opus-5, openai/gpt-…',
    keyHint: 'Clé créée sur openrouter.ai (sk-or-…)',
  },
  {
    id: 'groq',
    label: 'Groq',
    api: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelPlaceholder: 'llama-3.3-70b-versatile',
    keyHint: 'Clé créée sur console.groq.com (gsk_…)',
  },
  {
    id: 'custom',
    label: 'Autre (API compatible OpenAI)',
    api: 'openai',
    baseUrl: '',
    customUrl: true,
    modelPlaceholder: 'identifiant du modèle',
    keyHint: 'Clé API du fournisseur (ou valeur factice pour un serveur local)',
  },
]

/** Retrouve le pré-réglage correspondant à un profil existant. */
export function presetForProfile(api: 'anthropic' | 'openai', baseUrl: string): AiProviderPreset {
  const found = AI_PRESETS.find((p) => p.api === api && p.baseUrl === baseUrl && !p.customUrl)
  if (found) return found
  return api === 'anthropic' ? AI_PRESETS[0] : AI_PRESETS[AI_PRESETS.length - 1]
}

/** Modification localisée dans le document (lignes 1-indexées, incluses). */
export interface AiResolvedEdit {
  first_line: number
  last_line: number
  replacement: string
  reason: string
}

/** Proposition en attente de validation par l'utilisateur. */
export type AiProposal =
  | {
      kind: 'selection'
      /** Bornes (caractères) de la sélection dans l'éditeur Markdown. */
      from: number
      to: number
      original: string
      proposed: string
    }
  | {
      kind: 'document'
      /** Markdown complet au moment de la requête (sécurité anti-écrasement). */
      baseline: string
      edits: AiResolvedEdit[]
    }

/** Recherche une séquence de lignes dans le document (exacte ou trim). */
function findLines(lines: string[], needle: string[], from: number, trimmed: boolean): number {
  const norm = (s: string) => (trimmed ? s.trim() : s)
  const target = needle.map(norm)
  outer: for (let i = from; i <= lines.length - target.length; i++) {
    for (let j = 0; j < target.length; j++) {
      if (norm(lines[i + j]) !== target[j]) continue outer
    }
    return i
  }
  return -1
}

/**
 * Localise chaque modification de l'agent : l'ancre `original` est cherchée
 * dans le document (exacte d'abord, puis insensible aux espaces de bord).
 * Une ancre introuvable ou ambiguë est rejetée — comptée dans `dropped` —
 * plutôt qu'appliquée au mauvais endroit. Les chevauchements sont écartés,
 * les modifications sans effet ignorées.
 */
export function resolveEdits(
  edits: AiEdit[],
  baseline: string
): { resolved: AiResolvedEdit[]; dropped: number } {
  const lines = baseline.split('\n')
  const blankDocument = baseline.trim() === ''
  const located: AiResolvedEdit[] = []
  let dropped = 0
  let searchFrom = 0 // les modifications arrivent dans l'ordre du document

  for (const e of edits ?? []) {
    if (typeof e?.original !== 'string' || typeof e?.replacement !== 'string') {
      dropped++
      continue
    }
    const reason = (e.reason ?? '').trim()
    if (e.original.trim() === '') {
      // Ancre vide : autorisée uniquement pour remplir un document vide
      if (blankDocument && e.replacement.trim() !== '') {
        located.push({ first_line: 1, last_line: lines.length, replacement: e.replacement, reason })
      } else {
        dropped++
      }
      continue
    }
    const needle = e.original.split('\n')
    let at = findLines(lines, needle, searchFrom, false)
    if (at < 0) at = findLines(lines, needle, 0, false)
    if (at < 0) at = findLines(lines, needle, 0, true)
    if (at < 0) {
      dropped++
      continue
    }
    located.push({
      first_line: at + 1,
      last_line: at + needle.length,
      replacement: e.replacement,
      reason,
    })
    searchFrom = at + needle.length
  }

  located.sort((a, b) => a.first_line - b.first_line)
  const resolved: AiResolvedEdit[] = []
  let lastCovered = 0
  for (const e of located) {
    if (e.first_line <= lastCovered) {
      dropped++ // chevauchement : écarté
      continue
    }
    const sliceText = lines.slice(e.first_line - 1, e.last_line).join('\n')
    if (sliceText === e.replacement) continue // aucun changement réel
    resolved.push(e)
    lastCovered = e.last_line
  }
  return { resolved, dropped }
}

/**
 * Hunks à présenter dans la revue. Coordonnées relatives au texte de
 * référence de la proposition (sélection ou document complet) — le même
 * référentiel que `applyHunks`.
 */
export function proposalHunks(proposal: AiProposal): DiffHunk[] {
  if (proposal.kind === 'selection') {
    return diffLines(proposal.original, proposal.proposed)
  }
  const lines = proposal.baseline.split('\n')
  const hunks: DiffHunk[] = []
  for (const e of proposal.edits) {
    const sliceText = lines.slice(e.first_line - 1, e.last_line).join('\n')
    // Diff local : ne montre (et n'applique) que ce qui change vraiment
    for (const h of diffLines(sliceText, e.replacement)) {
      hunks.push({ ...h, startOld: h.startOld + e.first_line - 1, reason: e.reason })
    }
  }
  return hunks
}

/** Texte de référence sur lequel s'appliquent les hunks d'une proposition. */
export function proposalBase(proposal: AiProposal): string {
  return proposal.kind === 'selection' ? proposal.original : proposal.baseline
}
