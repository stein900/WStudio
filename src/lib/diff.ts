/**
 * Diff ligne à ligne (LCS) utilisé par la revue des propositions de l'IA :
 * chaque « hunk » regroupe des lignes remplacées, supprimées ou insérées,
 * que l'utilisateur accepte ou refuse individuellement.
 */

export interface DiffHunk {
  /** Index (0-based) de la première ligne remplacée dans le texte d'origine. */
  startOld: number
  /** Lignes d'origine remplacées (vide pour une insertion pure). */
  oldLines: string[]
  /** Nouvelles lignes (vide pour une suppression pure). */
  newLines: string[]
  /** Justification affichée dans la revue (fournie par l'agent). */
  reason?: string
}

/** Au-delà de ce produit n×m, le LCS est abandonné (un seul hunk global). */
const LCS_LIMIT = 4_000_000

export function diffLines(oldText: string, newText: string): DiffHunk[] {
  const a = oldText.split('\n')
  const b = newText.split('\n')

  // Préfixe et suffixe communs : réduit la matrice LCS au cœur du changement
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }

  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  if (midA.length === 0 && midB.length === 0) return []

  if (midA.length * midB.length > LCS_LIMIT) {
    return [{ startOld: start, oldLines: midA, newLines: midB }]
  }

  // LCS classique par programmation dynamique
  const n = midA.length
  const m = midB.length
  const lcs = new Uint32Array((n + 1) * (m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * (m + 1) + j] =
        midA[i] === midB[j]
          ? lcs[(i + 1) * (m + 1) + j + 1] + 1
          : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1])
    }
  }

  // Parcours : regroupe les lignes modifiées contiguës en hunks
  const hunks: DiffHunk[] = []
  let i = 0
  let j = 0
  let current: DiffHunk | null = null
  const flush = () => {
    if (current) hunks.push(current)
    current = null
  }
  while (i < n || j < m) {
    if (i < n && j < m && midA[i] === midB[j]) {
      flush()
      i++
      j++
    } else {
      if (!current) current = { startOld: start + i, oldLines: [], newLines: [] }
      // Priorité au chemin qui préserve le LCS
      if (j >= m || (i < n && lcs[(i + 1) * (m + 1) + j] >= lcs[i * (m + 1) + j + 1])) {
        current.oldLines.push(midA[i])
        i++
      } else {
        current.newLines.push(midB[j])
        j++
      }
    }
  }
  flush()
  return hunks
}

/**
 * Reconstruit le texte en appliquant uniquement les hunks acceptés.
 * Les hunks doivent provenir de `diffLines(oldText, …)` (triés, disjoints).
 */
export function applyHunks(oldText: string, hunks: DiffHunk[], accepted: boolean[]): string {
  const lines = oldText.split('\n')
  const out: string[] = []
  let cursor = 0
  hunks.forEach((h, idx) => {
    out.push(...lines.slice(cursor, h.startOld))
    out.push(...(accepted[idx] ? h.newLines : h.oldLines))
    cursor = h.startOld + h.oldLines.length
  })
  out.push(...lines.slice(cursor))
  return out.join('\n')
}
