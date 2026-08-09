import Image from '@tiptap/extension-image'
import { mergeAttributes } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import {
  imageStyleCss,
  parseImageStyle,
  serializeImageStyle,
  type ImageStyle,
} from '../lib/imageStyle'

/** État de sérialisation de tiptap-markdown (prosemirror-markdown). */
interface MdState {
  write(text: string): void
  esc(text: string, startOfLine?: boolean): string
  closeBlock(node: PMNode): void
}

/** Attributs du nœud → réglages visuels (n'inclut que les valeurs actives). */
function styleOf(attrs: Record<string, unknown>): ImageStyle {
  const s: ImageStyle = {}
  if (typeof attrs.width === 'number') s.width = attrs.width
  if (typeof attrs.radius === 'number' && attrs.radius) s.radius = attrs.radius
  if (typeof attrs.rotate === 'number' && attrs.rotate) s.rotate = attrs.rotate
  if (attrs.align === 'left' || attrs.align === 'center' || attrs.align === 'right')
    s.align = attrs.align
  return s
}

/** Attribut alimenté par le descripteur « ws:… » du titre de l'image ; jamais
 * rendu tel quel en HTML (le descripteur complet est recomposé au renderHTML). */
function styleAttr(key: keyof ImageStyle) {
  return {
    default: null as null,
    parseHTML: (el: HTMLElement) => parseImageStyle(el.getAttribute('title'))?.[key] ?? null,
    renderHTML: () => ({}),
  }
}

// icônes de la bulle (traits « alignement de texte » classiques + réinitialiser)
const SVG = (d: string) =>
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`
const ICONS = {
  left: SVG('M3 6h18M3 10h10M3 14h18M3 18h10'),
  center: SVG('M3 6h18M7 10h10M3 14h18M7 18h10'),
  right: SVG('M3 6h18M11 10h10M3 14h18M11 18h10'),
  reset: SVG('M3 12a9 9 0 1 0 2.8-6.5M3 4v5h5'),
}

/**
 * Image avec habillage visuel : redimensionnement par poignées d'angle,
 * coins arrondis, rotation et alignement via une bulle de réglages — le tout
 * persisté dans le TITRE Markdown standard de l'image (voir lib/imageStyle),
 * jamais dans du HTML embarqué : le .md reste portable et lisible partout.
 */
export const StyledImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // un descripteur « ws:… » n'est pas un vrai titre : ne pas le garder
      title: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const t = el.getAttribute('title')
          return t && parseImageStyle(t) ? null : t
        },
      },
      width: styleAttr('width'),
      radius: styleAttr('radius'),
      rotate: styleAttr('rotate'),
      align: styleAttr('align'),
    }
  },

  renderHTML({ node, HTMLAttributes }) {
    const style = styleOf(node.attrs)
    const desc = serializeImageStyle(style)
    const attrs: Record<string, unknown> = { ...HTMLAttributes }
    if (desc) {
      // titre = descripteur (round-trip copier/coller), style = même CSS que le PDF
      attrs.title = desc
      attrs.style = imageStyleCss(style)
    }
    return ['img', mergeAttributes(this.options.HTMLAttributes, attrs)]
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MdState, node: PMNode) {
          const a = node.attrs as Record<string, unknown>
          const desc = serializeImageStyle(styleOf(a))
          const title = desc ?? ((a.title as string) || null)
          state.write(
            '![' +
              state.esc(String(a.alt ?? '')) +
              '](' +
              String(a.src ?? '').replace(/[()]/g, '\\$&') +
              (title ? ' "' + title.replace(/"/g, '\\"') + '"' : '') +
              ')'
          )
          // l'image est un nœud de BLOC dans ce schéma : sans fermeture, le
          // sérialiseur colle le bloc suivant sur la même ligne (le défaut de
          // prosemirror-markdown suppose une image en ligne) — les lignes
          // vides du document disparaissaient à chaque sauvegarde.
          state.closeBlock(node)
        },
        // parsing : le markdown-it de tiptap-markdown rend le titre sur <img>,
        // les parseHTML des attributs ci-dessus font le reste
        parse: {},
      },
    }
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let currentNode = node

      const dom = document.createElement('div')
      dom.className = 'ws-img-view'
      const box = document.createElement('div')
      box.className = 'ws-img-box'
      const img = document.createElement('img')
      img.draggable = false
      box.appendChild(img)
      dom.appendChild(box)

      // ---- poignées de redimensionnement (4 angles) ----------------------
      const corners = ['nw', 'ne', 'sw', 'se'] as const
      const handles = corners.map((corner) => {
        const h = document.createElement('div')
        h.className = `ws-img-handle ws-img-handle-${corner}`
        h.dataset.corner = corner
        box.appendChild(h)
        return h
      })

      // ---- bulle de réglages --------------------------------------------
      const controls = document.createElement('div')
      controls.className = 'ws-img-controls'
      controls.contentEditable = 'false'
      box.appendChild(controls)

      const commit = (patch: Record<string, unknown>) => {
        const pos = typeof getPos === 'function' ? getPos() : null
        if (pos == null) return
        const { state } = editor.view
        const n = state.doc.nodeAt(pos)
        if (!n) return
        const tr = state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, ...patch })
        // garder l'image sélectionnée : la bulle reste ouverte pendant les réglages
        tr.setSelection(NodeSelection.create(tr.doc, pos))
        editor.view.dispatch(tr)
      }

      const mkBtn = (title: string, svg: string, onClick: () => void) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'tb-btn ws-img-btn'
        b.title = title
        b.innerHTML = svg
        b.addEventListener('mousedown', (e) => e.preventDefault())
        b.addEventListener('click', onClick)
        return b
      }

      // rangée 1 : alignement + largeur courante + réinitialisation
      const row1 = document.createElement('div')
      row1.className = 'ws-img-row'
      const alignBtns = (['left', 'center', 'right'] as const).map((a) =>
        mkBtn(
          { left: 'Aligner à gauche', center: 'Centrer', right: 'Aligner à droite' }[a],
          ICONS[a],
          () => commit({ align: currentNode.attrs.align === a ? null : a })
        )
      )
      const badge = document.createElement('span')
      badge.className = 'ws-img-badge'
      const resetBtn = mkBtn('Réinitialiser l’image', ICONS.reset, () =>
        commit({ width: null, radius: null, rotate: null, align: null })
      )
      row1.append(...alignBtns, badge, resetBtn)

      // rangées 2 et 3 : curseurs arrondi / rotation — aperçu direct pendant
      // le glissement (style seul), écriture dans le document au relâchement
      const mkSlider = (
        label: string,
        min: number,
        max: number,
        preview: (v: number) => void,
        write: (v: number) => void,
        format: (v: number) => string
      ) => {
        const row = document.createElement('div')
        row.className = 'ws-img-row'
        const lab = document.createElement('span')
        lab.className = 'ws-img-label'
        lab.textContent = label
        const input = document.createElement('input')
        input.type = 'range'
        input.min = String(min)
        input.max = String(max)
        input.step = '1'
        const val = document.createElement('span')
        val.className = 'ws-img-value'
        input.addEventListener('input', () => {
          const v = Number(input.value)
          val.textContent = format(v)
          preview(v)
        })
        input.addEventListener('change', () => write(Number(input.value)))
        row.append(lab, input, val)
        return { row, input, val }
      }
      const radius = mkSlider(
        'Arrondi',
        0,
        60,
        (v) => (img.style.borderRadius = v ? `${v}px` : ''),
        (v) => commit({ radius: v || null }),
        (v) => `${v} px`
      )
      const rotate = mkSlider(
        'Rotation',
        -180,
        180,
        (v) => (img.style.transform = v ? `rotate(${v}deg)` : ''),
        (v) => commit({ rotate: v || null }),
        (v) => `${v}°`
      )
      controls.append(row1, radius.row, rotate.row)

      // ---- synchronisation DOM ← attributs (toujours SYNCHRONE : un
      // NodeView recréé par la pagination doit retrouver sa géométrie
      // immédiatement, sinon oscillation de hauteur → tempête de reflows) ----
      const applyAttrs = () => {
        const a = currentNode.attrs
        if (img.getAttribute('src') !== a.src) img.setAttribute('src', a.src)
        img.alt = a.alt || ''
        box.style.width = a.width != null ? `${a.width}%` : ''
        img.style.width = a.width != null ? '100%' : ''
        img.style.borderRadius = a.radius ? `${a.radius}px` : ''
        img.style.transform = a.rotate ? `rotate(${a.rotate}deg)` : ''
        dom.style.textAlign = a.align || ''
        badge.textContent = a.width != null ? `${Math.round(a.width)} %` : '100 %'
        radius.input.value = String(a.radius ?? 0)
        radius.val.textContent = `${a.radius ?? 0} px`
        rotate.input.value = String(a.rotate ?? 0)
        rotate.val.textContent = `${a.rotate ?? 0}°`
        alignBtns.forEach((b, i) =>
          b.classList.toggle('is-active', a.align === (['left', 'center', 'right'] as const)[i])
        )
      }

      // bulle au-dessus de l'image, ou en dessous si le haut est hors champ
      const placeControls = () => {
        const r = box.getBoundingClientRect()
        const sc = dom.closest('.doc-scroll')?.getBoundingClientRect()
        controls.classList.toggle('is-below', r.top - (sc?.top ?? 0) < 140)
      }

      const syncSelected = () => {
        const pos = typeof getPos === 'function' ? getPos() : null
        if (pos == null) return
        const sel = editor.state.selection
        const selected = sel instanceof NodeSelection && sel.from === pos
        const was = dom.classList.contains('is-selected')
        dom.classList.toggle('is-selected', selected)
        if (selected && !was) placeControls()
      }
      editor.on('selectionUpdate', syncSelected)

      // ---- redimensionnement par glissement d'une poignée ----------------
      const startDrag = (e: MouseEvent, corner: string) => {
        e.preventDefault()
        e.stopPropagation()
        const startX = e.clientX
        const startW = box.getBoundingClientRect().width
        const contentW = dom.clientWidth || 1
        const dir = corner === 'ne' || corner === 'se' ? 1 : -1
        let pct = (startW / contentW) * 100
        const move = (ev: MouseEvent) => {
          const w = Math.min(contentW, Math.max(28, startW + dir * (ev.clientX - startX)))
          pct = (w / contentW) * 100
          box.style.width = `${pct}%`
          img.style.width = '100%'
          badge.textContent = `${Math.round(pct)} %`
        }
        const up = () => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
          commit({ width: Math.round(pct * 10) / 10 })
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }
      handles.forEach((h) =>
        h.addEventListener('mousedown', (e) => startDrag(e, h.dataset.corner!))
      )

      applyAttrs()
      syncSelected()

      return {
        dom,
        update(n) {
          if (n.type !== currentNode.type) return false
          currentNode = n
          applyAttrs()
          syncSelected()
          return true
        },
        // la bulle et les poignées appartiennent au NodeView, pas au document
        stopEvent(event) {
          const t = event.target
          return (
            t instanceof globalThis.Node &&
            (controls.contains(t) ||
              (t instanceof HTMLElement && t.classList.contains('ws-img-handle')))
          )
        },
        // CRUCIAL (leçon Mermaid/KaTeX) : les mutations de la bulle et des
        // styles d'aperçu ne doivent jamais déclencher un redessin ProseMirror
        ignoreMutation(mutation) {
          return mutation.type !== 'selection'
        },
        destroy() {
          editor.off('selectionUpdate', syncSelected)
        },
      }
    }
  },
})
