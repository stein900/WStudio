import MarkdownIt from 'markdown-it'
import type { RendererRule } from 'markdown-it'
import hljs from 'highlight.js'
import katexPluginModule from '@vscode/markdown-it-katex'

// Paquet CJS exposant { default } : selon le bundler, l'import par défaut
// livre la fonction ou l'espace de noms — on prend la fonction dans les deux cas.
const katexPlugin =
  (katexPluginModule as unknown as { default?: typeof katexPluginModule }).default ??
  katexPluginModule
import mermaid from 'mermaid'
import { imageStyleCss, parseImageStyle } from './imageStyle'

mermaid.initialize({
  startOnLoad: false,
  theme: 'neutral',
  securityLevel: 'loose',
  fontFamily: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  // htmlLabels:false — les étiquettes en foreignObject HTML sont invisibles ou
  // mal placées après clonage par Paged.js ; le texte SVG natif imprime bien.
  flowchart: { htmlLabels: false, curve: 'basis' },
  er: { useMaxWidth: true },
  sequence: { useMaxWidth: true },
})

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      } catch {
        /* fall through */
      }
    }
    return ''
  },
})

// markdown-it rejette file:// par défaut (validateLink) — or les images de
// projet sont résolues en file:// pour l'aperçu/export, et en wstudio://
// dans l'éditeur. Sans ceci, elles disparaissent silencieusement du rendu.
const defaultValidateLink = md.validateLink.bind(md)
md.validateLink = (url: string) => /^(file|wstudio):/i.test(url) || defaultValidateLink(url)

// Mathématiques LaTeX : $…$ en ligne, $$…$$ en bloc, rendues par KaTeX
// (sortie HTML synchrone ; la feuille katex.min.css est chargée par l'app
// ET par le document d'aperçu/export — servie depuis public/katex/).
md.use(katexPlugin, { throwOnError: false, output: 'html' })

// Les blocs ```mermaid deviennent des conteneurs hydratés ensuite (aperçu) ou
// remplacés par leur SVG (export).
const defaultFence: RendererRule = md.renderer.rules.fence!
md.renderer.rules.fence = ((tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const info = token.info.trim().toLowerCase()
  if (info === 'mermaid') {
    return `<div class="mermaid-diagram" data-mermaid="${encodeURIComponent(token.content)}"></div>`
  }
  return defaultFence(tokens, idx, options, env, self)
}) as RendererRule

// Les réglages visuels d'une image vivent dans son TITRE Markdown (« ws:… »,
// voir lib/imageStyle) : traduits ici en style inline, et le titre est retiré
// — le descripteur ne doit jamais apparaître en info-bulle dans le PDF.
const defaultImage: RendererRule = md.renderer.rules.image!
md.renderer.rules.image = ((tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const title = token.attrGet('title')
  const style = parseImageStyle(typeof title === 'string' ? title : null)
  if (style) {
    token.attrs = (token.attrs ?? []).filter(([name]) => name !== 'title')
    const css = imageStyleCss(style)
    if (css) token.attrSet('style', css)
  }
  return defaultImage(tokens, idx, options, env, self)
}) as RendererRule

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  )
}

export interface RenderOptions {
  /** Génère le sommaire même sans marqueur [TOC] dans le document. */
  forceToc?: boolean
}

/**
 * Rend le Markdown en HTML : ids uniques sur les titres, marqueur [TOC]
 * remplacé par un sommaire (nav.report-toc) pointant vers les titres.
 */
export function renderMarkdown(source: string, opts: RenderOptions = {}): string {
  const html = md.render(source)
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = doc.getElementById('root')!

  const used = new Set<string>()
  const headings = Array.from(root.querySelectorAll('h1, h2, h3, h4'))
  for (const h of headings) {
    // Préfixe obligatoire : un id commençant par un chiffre est un sélecteur
    // CSS invalide et fait échouer Paged.js (target-counter du sommaire).
    let id = `sec-${slugify(h.textContent || '')}`
    let i = 2
    while (used.has(id)) id = `sec-${slugify(h.textContent || '')}-${i++}`
    used.add(id)
    h.id = id
  }

  // Marqueur [TOC] : un paragraphe dont le texte est exactement [TOC]
  const tocMarkers = Array.from(root.querySelectorAll('p')).filter(
    (p) => p.textContent?.trim().toUpperCase() === '[TOC]'
  )

  const wantsToc = tocMarkers.length > 0 || opts.forceToc
  if (wantsToc) {
    const nav = doc.createElement('nav')
    nav.className = 'report-toc'
    nav.innerHTML = '<h2 class="report-toc-title">Sommaire</h2>'
    const list = doc.createElement('ul')
    for (const h of headings) {
      const level = Number(h.tagName[1])
      if (level < 2 || level > 3) continue // sommaire sur H2/H3
      const li = doc.createElement('li')
      li.className = `toc-level-${level}`
      const a = doc.createElement('a')
      a.href = `#${h.id}`
      a.textContent = h.textContent
      li.appendChild(a)
      list.appendChild(li)
    }
    nav.appendChild(list)

    if (tocMarkers.length > 0) {
      tocMarkers[0].replaceWith(nav)
      tocMarkers.slice(1).forEach((p) => p.remove())
    } else {
      const firstH1 = root.querySelector('h1')
      if (firstH1) firstH1.after(nav)
      else root.prepend(nav)
    }
  }

  return root.innerHTML
}

// --- Rendu Mermaid -----------------------------------------------------------

const svgCache = new Map<string, string>()
let mermaidId = 0

/** Lecture synchrone du cache — nécessaire pour peupler un NodeView recréé
 * sans oscillation de hauteur (sinon : boucle repagination ↔ recréation). */
export function getCachedMermaidSvg(code: string): string | undefined {
  return svgCache.get(code)
}

export async function renderMermaidToSvg(code: string): Promise<string> {
  const cached = svgCache.get(code)
  if (cached) return cached
  const id = `mmd-${++mermaidId}`
  try {
    const { svg } = await mermaid.render(id, code)
    svgCache.set(code, svg)
    return svg
  } catch (err) {
    // mermaid peut laisser un élément temporaire dans le body en cas d'erreur
    document.getElementById(`d${id}`)?.remove()
    const msg = err instanceof Error ? err.message : String(err)
    const fallback = `<div class="mermaid-error"><strong>Erreur de syntaxe Mermaid</strong><pre>${escapeHtml(
      msg
    )}\n\n${escapeHtml(code)}</pre></div>`
    return fallback
  }
}

/** Hydrate tous les conteneurs .mermaid-diagram d'un élément (aperçu live). */
export async function hydrateMermaid(container: HTMLElement): Promise<void> {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>('.mermaid-diagram'))
  await Promise.all(
    nodes.map(async (node) => {
      const code = decodeURIComponent(node.dataset.mermaid || '')
      node.innerHTML = await renderMermaidToSvg(code)
    })
  )
}

/** Rendu complet pour l'export : HTML final avec SVG Mermaid intégrés. */
export async function renderForExport(source: string, opts: RenderOptions = {}): Promise<string> {
  const html = renderMarkdown(source, opts)
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = doc.getElementById('root')!
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('.mermaid-diagram'))
  for (const node of nodes) {
    const code = decodeURIComponent(node.dataset.mermaid || '')
    node.innerHTML = await renderMermaidToSvg(code)
  }
  // Blocs de code très longs : ils devront de toute façon être coupés entre
  // deux pages. On les marque (break-inside: auto côté CSS) et on retire la
  // coloration syntaxique — couper au milieu des <span> de highlight.js fait
  // caler la pagination de Paged.js et tronque le document.
  for (const codeEl of Array.from(root.querySelectorAll('pre > code'))) {
    const lineCount = (codeEl.textContent || '').split('\n').length
    if (lineCount > 35) {
      codeEl.parentElement!.classList.add('pre-long')
      codeEl.textContent = codeEl.textContent
    }
  }
  return root.innerHTML
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
