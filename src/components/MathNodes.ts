import { InputRule, Node, textblockTypeInputRule } from '@tiptap/core'
import type { NodeViewRenderer } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import katex from 'katex'
import katexPluginModule from '@vscode/markdown-it-katex'

/** Surface minimale de l'instance markdown-it utilisée dans parse.setup. */
interface MarkdownItLike {
  use(plugin: unknown, options?: unknown): unknown
  utils: { escapeHtml(s: string): string }
  renderer: { rules: Record<string, unknown> }
}

// Paquet CJS { default } : selon le bundler l'import par défaut livre la
// fonction ou l'espace de noms (même garde que dans lib/markdown.ts).
const katexPlugin =
  (katexPluginModule as unknown as { default?: typeof katexPluginModule }).default ??
  katexPluginModule

/** État de sérialisation de tiptap-markdown (prosemirror-markdown). */
interface MdState {
  write(text: string): void
  text(text: string, escape?: boolean): void
  ensureNewLine(): void
  closeBlock(node: PMNode): void
}

// Zoom de réduction mémorisé par source : un NodeView recréé par la
// pagination doit retrouver sa hauteur SYNCHRONEMENT (leçon Mermaid), sinon
// l'application différée du zoom fait osciller les hauteurs → tempête de
// repagination. La largeur de page étant fixe, la source suffit comme clé.
const zoomCache = new Map<string, string>()

/**
 * NodeView commun aux formules en ligne et aux blocs d'équation — même
 * logique que le bloc Mermaid : le rendu KaTeX remplace la source, un clic
 * (ou l'entrée du curseur) révèle la source LaTeX, la sortie de sélection
 * re-rend. KaTeX est synchrone : pas d'oscillation de hauteur, la
 * pagination reste stable.
 */
function mathNodeView(displayMode: boolean): NodeViewRenderer {
  return ({ node, editor, getPos }) => {
    let currentNode = node
    const dom = document.createElement(displayMode ? 'div' : 'span')
    dom.className = `math-view ${displayMode ? 'math-view-block' : 'math-view-inline'}`
    const src = document.createElement('code')
    src.className = 'math-src'
    src.spellcheck = false
    const rendered = document.createElement(displayMode ? 'div' : 'span')
    rendered.className = 'math-render'
    rendered.contentEditable = 'false'
    dom.append(src, rendered)

    let lastRendered: string | null = null
    const render = () => {
      const source = currentNode.textContent
      if (source === lastRendered) return
      lastRendered = source
      rendered.innerHTML = source.trim()
        ? katex.renderToString(source, { throwOnError: false, displayMode })
        : ''
      dom.classList.toggle('is-empty', !source.trim())
      // équation plus large que la page : réduction homothétique (zoom
      // affecte la mise en page, contrairement à transform), appliquée
      // SYNCHRONEMENT depuis le cache pour garder des hauteurs stables
      if (displayMode) {
        const cached = zoomCache.get(source)
        if (cached) {
          rendered.style.setProperty('zoom', cached)
        } else {
          rendered.style.removeProperty('zoom')
          setTimeout(() => {
            if (!rendered.isConnected || currentNode.textContent !== source) return
            const inner = rendered.querySelector<HTMLElement>('.katex')
            const avail = rendered.clientWidth
            if (inner && avail > 0 && inner.scrollWidth > avail) {
              const z = String(Math.max(0.45, (avail - 4) / inner.scrollWidth))
              zoomCache.set(source, z)
              rendered.style.setProperty('zoom', z)
            }
          }, 0)
        }
      }
    }

    // L'état « en édition » est TOUJOURS recalculé depuis la sélection —
    // jamais un simple drapeau posé au clic : la pagination recrée les
    // NodeViews à volonté, et un état perdu laisserait le curseur dans une
    // source masquée (display:none), que ProseMirror combat en boucle.
    const syncEditing = () => {
      const pos = typeof getPos === 'function' ? getPos() : null
      if (pos == null) return
      const { from } = editor.state.selection
      const inside = from > pos && from < pos + currentNode.nodeSize
      const was = dom.classList.contains('is-editing')
      if (inside && !was) {
        dom.classList.add('is-editing')
      } else if (!inside && was) {
        dom.classList.remove('is-editing')
        render()
      }
    }

    render()
    syncEditing()

    // mousedown (avant le traitement ProseMirror) : ouvrir l'édition et poser
    // le curseur en fin de source
    rendered.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const pos = typeof getPos === 'function' ? getPos() : null
      if (pos == null) return
      dom.classList.add('is-editing')
      editor.commands.setTextSelection(pos + currentNode.nodeSize - 1)
      editor.view.focus()
    })

    editor.on('selectionUpdate', syncEditing)

    return {
      dom,
      contentDOM: src,
      update(n) {
        if (n.type !== currentNode.type) return false
        currentNode = n
        syncEditing()
        if (!dom.classList.contains('is-editing')) render()
        return true
      },
      // CRUCIAL (leçon Mermaid) : l'injection du HTML KaTeX est une mutation
      // hors contentDOM — sans ceci, redessin → re-injection → boucle infinie.
      ignoreMutation(mutation) {
        if (mutation.type === 'selection') return false
        return !src.contains(mutation.target)
      },
      destroy() {
        editor.off('selectionUpdate', syncEditing)
      },
    }
  }
}

/** Formule en ligne `$…$`. */
export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  content: 'text*',
  marks: '',
  code: true,
  defining: true,

  parseHTML() {
    return [{ tag: 'span[data-math-inline]', preserveWhitespace: 'full' as const }]
  },

  renderHTML() {
    return ['span', { 'data-math-inline': '' }, 0]
  },

  addNodeView() {
    return mathNodeView(false)
  },

  addInputRules() {
    return [
      // taper `$…$` convertit en formule rendue (hors blocs de code)
      new InputRule({
        find: /\$([^$\s][^$]*)\$$/,
        handler: ({ state, range, match }) => {
          const $from = state.doc.resolve(range.from)
          if ($from.parent.type.spec.code) return
          const content = match[1] ? state.schema.text(match[1]) : undefined
          state.tr.replaceRangeWith(range.from, range.to, this.type.create(null, content))
        },
      }),
    ]
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MdState, node: PMNode) {
          state.write(`$${node.textContent}$`)
        },
        parse: {
          // markdown-it de tiptap-markdown : tokéniser $…$/$$…$$ (plugin
          // KaTeX) mais rendre des balises neutres portant la SOURCE, que
          // parseHTML des nœuds récupère.
          setup(md: MarkdownItLike) {
            md.use(katexPlugin, { throwOnError: false })
            const esc = md.utils.escapeHtml
            const rules = md.renderer.rules as Record<
              string,
              (tokens: { content: string }[], idx: number) => string
            >
            const inline = (tokens: { content: string }[], idx: number) =>
              `<span data-math-inline>${esc(tokens[idx].content)}</span>`
            const block = (tokens: { content: string }[], idx: number) =>
              `<div data-math-block>${esc(tokens[idx].content)}</div>\n`
            rules.math_inline = inline
            rules.math_inline_in_html_block = inline
            rules.math_block = block
            rules.math_block_in_html_block = block
            rules.math_inline_block = block
            rules.math_inline_bare_block = block
          },
        },
      },
    }
  },
})

/** Bloc d'équation `$$…$$` (posé, centré). */
export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-math-block]', preserveWhitespace: 'full' as const }]
  },

  renderHTML() {
    return ['div', { 'data-math-block': '' }, 0]
  },

  addNodeView() {
    return mathNodeView(true)
  },

  addKeyboardShortcuts() {
    return {
      // Entrée = nouvelle ligne DANS l'équation (pas de scission du bloc)
      Enter: () =>
        this.editor.commands.command(({ state, tr }) => {
          const { $from, empty } = state.selection
          if (!empty || $from.parent.type.name !== this.name) return false
          tr.insertText('\n')
          return true
        }),
    }
  },

  addInputRules() {
    // `$$ ` en début de paragraphe crée un bloc d'équation
    return [textblockTypeInputRule({ find: /^\$\$\s$/, type: this.type })]
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MdState, node: PMNode) {
          state.write('$$\n')
          state.text(node.textContent, false)
          state.ensureNewLine()
          state.write('$$')
          state.closeBlock(node)
        },
        parse: {}, // la tokénisation est installée par MathInline (une seule fois)
      },
    }
  },
})
