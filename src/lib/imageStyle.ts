/**
 * Habillage visuel des images — le Markdown reste 100 % standard : les
 * réglages (largeur, coins arrondis, rotation, alignement) sont encodés dans
 * le TITRE de l'image, champ CommonMark prévu pour des métadonnées :
 *
 *   ![légende](assets/photo.png "ws:w=62.5;r=12;rot=-3;align=center")
 *
 * N'importe quel lecteur Markdown affiche l'image normalement (le descripteur
 * n'apparaît au pire qu'en info-bulle) ; seul le moteur WStudio l'interprète —
 * l'éditeur Document (StyledImage) et le rendu aperçu/export (markdown-it).
 * Ce module est LEUR source commune : même descripteur, même CSS, aucune
 * divergence possible entre l'écran et le PDF.
 */

export interface ImageStyle {
  /** Largeur en % de la largeur utile de la page (absent = taille naturelle). */
  width?: number
  /** Rayon des coins en px. */
  radius?: number
  /** Rotation en degrés — purement visuelle, l'encombrement ne change pas. */
  rotate?: number
  align?: 'left' | 'center' | 'right'
}

const PREFIX = 'ws:'

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const round1 = (v: number) => Math.round(v * 10) / 10

/** Décode un titre d'image ; null si ce n'est pas un descripteur WStudio. */
export function parseImageStyle(title: string | null | undefined): ImageStyle | null {
  if (!title || !title.startsWith(PREFIX)) return null
  const out: ImageStyle = {}
  for (const part of title.slice(PREFIX.length).split(';')) {
    const [key, raw] = part.split('=').map((s) => s.trim())
    if (!key || raw === undefined) continue
    const num = Number(raw)
    if (key === 'w' && Number.isFinite(num)) out.width = clamp(num, 3, 100)
    else if (key === 'r' && Number.isFinite(num)) out.radius = clamp(num, 0, 200)
    else if (key === 'rot' && Number.isFinite(num)) out.rotate = clamp(num, -180, 180)
    else if (key === 'align' && (raw === 'left' || raw === 'center' || raw === 'right'))
      out.align = raw
    // clé inconnue : ignorée (tolérance aux versions futures du format)
  }
  return out
}

/** Encode un descripteur ; null si aucun réglage (l'image reste « nue »). */
export function serializeImageStyle(s: ImageStyle): string | null {
  const parts: string[] = []
  if (s.width != null) parts.push(`w=${round1(s.width)}`)
  if (s.radius) parts.push(`r=${Math.round(s.radius)}`)
  if (s.rotate) parts.push(`rot=${round1(s.rotate)}`)
  if (s.align) parts.push(`align=${s.align}`)
  return parts.length ? PREFIX + parts.join(';') : null
}

/** CSS inline équivalent — appliqué tel quel dans l'aperçu et l'export PDF. */
export function imageStyleCss(s: ImageStyle): string {
  const parts: string[] = []
  if (s.width != null) parts.push(`width:${round1(s.width)}%`)
  if (s.radius) parts.push(`border-radius:${Math.round(s.radius)}px`)
  if (s.rotate) parts.push(`transform:rotate(${round1(s.rotate)}deg)`)
  if (s.align === 'center') parts.push('display:block', 'margin-left:auto', 'margin-right:auto')
  else if (s.align === 'right') parts.push('display:block', 'margin-left:auto')
  else if (s.align === 'left') parts.push('display:block', 'margin-right:auto')
  return parts.join(';')
}
