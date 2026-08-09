/**
 * Images de projet : stockées en fichiers dans <projet>\assets\ et référencées
 * en relatif (`assets/img-xxx.png`) dans le Markdown — jamais en base64, qui
 * transforme un document de 2 pages en mégaoctets de texte et écroule tout
 * (éditeur, sérialisation, aperçu, sauvegarde).
 *
 * Le Markdown est la source de vérité (chemins RELATIFS, portables). Chaque
 * consommateur résout ces chemins dans son propre contexte :
 *  - éditeur Document (page http en dev, file:// empaquetée) → protocole
 *    interne `wstudio://asset/<chemin absolu encodé>` servi par le main ;
 *  - aperçu / export PDF (fichiers temporaires) → URL file:// absolues.
 */

/** Chemin projet → base slash (comparable, insensible à la casse Windows). */
function slashed(projectPath: string): string {
  return projectPath.replace(/\\/g, '/')
}

/** URL affichable dans l'éditeur pour une ressource relative du projet. */
export function assetUrl(projectPath: string, rel: string): string {
  return `wstudio://asset/${encodeURIComponent(`${slashed(projectPath)}/${rel}`)}`
}

/** Markdown stocké (relatif) → markdown pour l'éditeur (URLs wstudio://). */
export function toEditorMarkdown(markdown: string, projectPath: string): string {
  return markdown.replace(
    /(!\[[^\]]*\]\()assets\/([^)\s]+)/g,
    (_m, pre: string, rel: string) => `${pre}${assetUrl(projectPath, `assets/${rel}`)}`
  )
}

/** Markdown sérialisé par l'éditeur → markdown stocké (chemins relatifs). */
export function fromEditorMarkdown(markdown: string, projectPath: string): string {
  const root = `${slashed(projectPath).toLowerCase()}/`
  return markdown.replace(/wstudio:\/\/asset\/([A-Za-z0-9%._~-]+)/g, (whole, enc: string) => {
    try {
      const abs = decodeURIComponent(enc)
      return abs.toLowerCase().startsWith(root) ? abs.slice(root.length) : whole
    } catch {
      return whole
    }
  })
}

/** Markdown stocké → markdown pour l'aperçu/export (URLs file:// absolues). */
export function resolveAssetsToFileUrls(markdown: string, projectPath: string): string {
  const base = `file:///${encodeURI(slashed(projectPath))}/`
  return markdown.replace(/(!\[[^\]]*\]\()assets\//g, `$1${base}assets/`)
}
