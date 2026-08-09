import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import CodeBlock from '@tiptap/extension-code-block'
import { Markdown } from 'tiptap-markdown'
import { PaginationPlus, type PaginationPlusOptions } from 'tiptap-pagination-plus'
import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { FindBar } from './FindBar'
import { Icon } from './Icons'
import { MathBlock, MathInline } from './MathNodes'
import { SearchReplace } from './SearchReplace'
import { assetUrl, fromEditorMarkdown, toEditorMarkdown } from '../lib/assets'
import { desktop } from '../lib/desktop'
import { escapeHtml, getCachedMermaidSvg, renderMermaidToSvg } from '../lib/markdown'
import { MM_TO_PX, pageMarginsMm, reportTypographyCss } from '../lib/reportTypography'
import type { PagedAnchors } from '../lib/exportPdf'
import type { PageSettings } from '../types'

interface Props {
  initialMarkdown: string
  onChange: (markdown: string) => void
  settings: PageSettings
  /** Dossier du projet WStudio (images en fichiers) ; absent en mode navigateur. */
  assetRoot?: string
  /** Ancres de coupure mesurées dans le rendu Paged.js : quand elles sont
   * présentes, les bandes de page de l'éditeur sont asservies aux coupures
   * réelles du PDF (fidélité par construction, l'écart ne s'accumule plus). */
  anchors?: PagedAnchors | null
}

type PaginationConfig = Pick<
  PaginationPlusOptions,
  | 'pageWidth'
  | 'pageHeight'
  | 'marginTop'
  | 'marginBottom'
  | 'marginLeft'
  | 'marginRight'
  | 'headerLeft'
  | 'headerRight'
  | 'footerLeft'
  | 'footerRight'
  | 'customHeader'
>

function paginationConfig(s: PageSettings): PaginationConfig {
  const hasHeader = Boolean(s.headerText || s.headerLogo)
  const m = pageMarginsMm(s)
  const headerLeft = s.headerLogo
    ? `<img src="${s.headerLogo}" style="height:34px;width:auto" alt="logo">`
    : ''
  return {
    pageWidth: Math.round(210 * MM_TO_PX),
    pageHeight: Math.round(297 * MM_TO_PX),
    marginTop: Math.round(m.top * MM_TO_PX),
    marginBottom: Math.round(m.bottom * MM_TO_PX),
    marginLeft: Math.round(m.side * MM_TO_PX),
    marginRight: Math.round(m.side * MM_TO_PX),
    headerLeft,
    headerRight: escapeHtml(s.headerText),
    footerLeft: escapeHtml(s.footerText),
    footerRight: s.pageNumbers ? '{page}' : '',
    customHeader:
      hasHeader && !s.headerOnFirstPage ? { 1: { headerLeft: '', headerRight: '' } } : {},
  }
}

/**
 * Bloc de code dont la variante `mermaid` affiche le diagramme rendu (comme
 * dans le PDF) : hauteur alignée sur l'export, clic sur le schéma pour éditer
 * le code source, sortie de sélection pour revenir au rendu.
 */
const SmartCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let currentNode = node
      const dom = document.createElement('div')
      dom.className = 'codeblock-view'
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      pre.appendChild(code)
      const diagram = document.createElement('div')
      diagram.className = 'mermaid-nodeview'
      diagram.contentEditable = 'false'
      dom.append(pre, diagram)

      let lastRendered: string | null = null
      const render = () => {
        if (localStorage.getItem('rapportcreator.nomermaid')) return
        const isMermaid = currentNode.attrs.language === 'mermaid'
        dom.classList.toggle('is-mermaid', isMermaid)
        if (!isMermaid) return
        const src = currentNode.textContent
        if (!src || src === lastRendered) return
        // Cache synchrone d'abord : un NodeView recréé doit retrouver sa
        // hauteur immédiatement, sinon hauteur qui oscille → repagination →
        // recréation → boucle infinie de reflows.
        const cached = getCachedMermaidSvg(src)
        if (cached !== undefined) {
          lastRendered = src
          diagram.innerHTML = cached
          return
        }
        lastRendered = src
        void renderMermaidToSvg(src).then((svg) => {
          if (lastRendered === src) diagram.innerHTML = svg
        })
      }
      render()

      diagram.addEventListener('click', () => {
        dom.classList.add('is-editing')
        const pos = typeof getPos === 'function' ? getPos() : null
        if (pos != null) editor.commands.setTextSelection(pos + 1)
        editor.view.focus()
      })
      const onSelection = () => {
        const pos = typeof getPos === 'function' ? getPos() : null
        if (pos == null) return
        const { from } = editor.state.selection
        const inside = from > pos && from < pos + currentNode.nodeSize
        if (!inside && dom.classList.contains('is-editing')) {
          dom.classList.remove('is-editing')
          render()
        }
      }
      editor.on('selectionUpdate', onSelection)

      return {
        dom,
        contentDOM: code,
        update(n) {
          if (n.type !== currentNode.type) return false
          currentNode = n
          // pendant l'édition, ne pas re-rendre à chaque frappe
          if (!dom.classList.contains('is-editing')) render()
          return true
        },
        // CRUCIAL : sans ceci, l'injection du SVG déclenche une mutation que
        // ProseMirror répercute en redessin du nœud → re-injection → boucle
        // infinie synchrone (interface gelée).
        ignoreMutation(mutation) {
          if (mutation.type === 'selection') return false
          return !pre.contains(mutation.target)
        },
        destroy() {
          editor.off('selectionUpdate', onSelection)
        },
      }
    }
  },
})

// ------------------------------------------------------------------
// Décorations de synchronisation : paddings persistants appliqués via
// ProseMirror (un style inline posé à la main serait effacé au premier
// redessin du nœud par l'éditeur ou l'extension de pagination).
// ------------------------------------------------------------------
interface PageSyncSpec {
  from: number
  to: number
  style?: string
  class?: string
  /** Calage sous une bande (asservissement) : valeur en px, posée aussi en
   * data-ws-pad pour être relue de façon fiable à la passe suivante. */
  pad?: number
}

const pageSyncKey = new PluginKey<DecorationSet>('pageSyncDeco')

const PageSyncDeco = Extension.create({
  name: 'pageSyncDeco',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: pageSyncKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const specs = tr.getMeta(pageSyncKey) as PageSyncSpec[] | undefined
            if (specs !== undefined) {
              return DecorationSet.create(
                tr.doc,
                specs.map((s) =>
                  Decoration.node(s.from, s.to, {
                    ...(s.style ? { style: s.style } : {}),
                    ...(s.class ? { class: s.class } : {}),
                    ...(s.pad !== undefined ? { 'data-ws-pad': String(s.pad) } : {}),
                  })
                )
              )
            }
            return old.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations(state) {
            return pageSyncKey.getState(state)
          },
        },
      }),
    ]
  },
})

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function serializeMarkdown(editor: Editor, assetRoot?: string): string {
  const storage = editor.storage as unknown as { markdown: { getMarkdown(): string } }
  // tiptap-markdown échappe les crochets : on restaure le marqueur [TOC].
  // NB : ne JAMAIS « déséchapper » le contenu des $…$ — les formules sont
  // des nœuds sérialisés BRUTS, et leurs \_ \{ … sont l'écriture de l'auteur
  // (une moulinette ici a déjà détruit \text{dup\_max} en dup_max → erreur).
  const md = storage.markdown.getMarkdown().replace(/^\\?\[TOC\\?\]\s*$/gim, '[TOC]')
  // URLs d'affichage wstudio:// → chemins relatifs portables dans le .md
  return assetRoot ? fromEditorMarkdown(md, assetRoot) : md
}

export function DocEditor({ initialMarkdown, onChange, settings, assetRoot, anchors }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Asservissement des bandes de page aux coupures du PDF : actif dès que des
  // ancres valides sont appliquées — la passe de synchronisation historique
  // (calibration, [TOC], Titre 1) s'efface alors, les ancres couvrent tout.
  const servoActiveRef = useRef(false)
  const bandStyleRef = useRef<HTMLStyleElement | null>(null)
  // instant de la dernière frappe : le recalage n'agit QUE au repos (règle
  // d'or type Word — pendant l'édition, rien ne bouge à part l'édition)
  const lastEditRef = useRef(0)

  // Sérialiser tout le document à CHAQUE frappe est O(taille du document) :
  // sur un gros rapport cela gèle l'édition. On ne sérialise qu'à l'accalmie,
  // avec vidage garanti au démontage (changement de mode, retour accueil).
  const serializeRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null
    editor: Editor | null
    pending: boolean
  }>({ timer: null, editor: null, pending: false })

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false },
        heading: { levels: [1, 2, 3, 4] },
        codeBlock: false,
      }),
      SmartCodeBlock,
      MathInline,
      MathBlock,
      SearchReplace,
      Image.configure({ allowBase64: true }),
      TableKit.configure({ table: { resizable: false } }),
      Markdown.configure({
        html: true,
        linkify: true,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      PaginationPlus.configure({
        ...paginationConfig(settings),
        pageGap: 18,
        pageGapBorderSize: 1,
        pageGapBorderColor: '#e8e8ec',
        pageBreakBackground: '#f5f5f7', // = --canvas (index.css)
        contentMarginTop: 0,
        contentMarginBottom: 0,
      }),
      PageSyncDeco,
    ],
    content: assetRoot ? toEditorMarkdown(initialMarkdown, assetRoot) : initialMarkdown,
    editorProps: {
      attributes: {
        class: 'doc-editor-content report-content',
        spellcheck: 'true',
        lang: 'fr',
      },
      handlePaste: (view, event) => {
        const items = Array.from(event.clipboardData?.items ?? [])
        const imageItem = items.find((i) => i.type.startsWith('image/'))
        if (!imageItem) return false
        const file = imageItem.getAsFile()
        if (!file) return false
        void fileToDataUrl(file).then(async (dataUrl) => {
          // en projet : l'image devient un fichier assets/, jamais du base64
          let src = dataUrl
          if (desktop && assetRoot) {
            const rel = await desktop.saveAsset({ projectPath: assetRoot, dataUrl })
            if (rel) src = assetUrl(assetRoot, rel)
          }
          const { schema } = view.state
          const node = schema.nodes.image.create({ src })
          view.dispatch(view.state.tr.replaceSelectionWith(node))
        })
        return true
      },
    },
    onUpdate: ({ editor }) => {
      lastEditRef.current = Date.now()
      const s = serializeRef.current
      s.editor = editor
      s.pending = true
      if (s.timer) clearTimeout(s.timer)
      s.timer = setTimeout(() => {
        s.pending = false
        if (!editor.isDestroyed) onChange(serializeMarkdown(editor, assetRoot))
      }, 500)
    },
  })

  // Vidage de la sérialisation en attente au démontage de l'éditeur
  useEffect(() => {
    const s = serializeRef.current
    return () => {
      if (s.timer) clearTimeout(s.timer)
      if (s.pending && s.editor && !s.editor.isDestroyed) {
        s.pending = false
        onChange(serializeMarkdown(s.editor, assetRoot))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Convertisseur d'images base64 : tout collage (HTML Google Docs, etc.) qui
  // introduit des <img src="data:..."> est réécrit vers des fichiers assets/ —
  // le document reste léger quelle que soit la provenance du contenu.
  useEffect(() => {
    const d = desktop
    if (!editor || !d || !assetRoot) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let running = false
    let disposed = false

    const convert = async () => {
      if (running || disposed || editor.isDestroyed) return
      running = true
      try {
        const sources = new Set<string>()
        editor.state.doc.descendants((node) => {
          const src = node.type.name === 'image' ? (node.attrs.src as string) : ''
          if (src.startsWith('data:image/')) sources.add(src)
        })
        for (const dataUrl of sources) {
          const rel = await d.saveAsset({ projectPath: assetRoot, dataUrl })
          if (!rel || disposed || editor.isDestroyed) continue
          const newSrc = assetUrl(assetRoot, rel)
          // re-repérer les nœuds : les positions ont pu bouger entre-temps
          const positions: number[] = []
          editor.state.doc.descendants((node, pos) => {
            if (node.type.name === 'image' && node.attrs.src === dataUrl) positions.push(pos)
          })
          if (positions.length === 0) continue
          let tr = editor.state.tr
          for (const pos of positions) {
            const node = editor.state.doc.nodeAt(pos)
            if (node) tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: newSrc })
          }
          editor.view.dispatch(tr)
        }
      } finally {
        running = false
      }
    }

    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void convert(), 700)
    }
    editor.on('update', schedule)
    schedule() // contenu initial

    return () => {
      disposed = true
      editor.off('update', schedule)
      if (timer) clearTimeout(timer)
    }
  }, [editor, assetRoot])

  // ------------------------------------------------------------------
  // Synchronisation avec la pagination du PDF :
  //  1. calibration — la zone de contenu mesurée entre deux bandes doit
  //     égaler celle du PDF (l'extension retranche l'en-tête de la zone
  //     utile, le PDF le loge dans la marge) ;
  //  2. [TOC] occupe sa page (comme le sommaire exporté) ;
  //  3. chaque Titre 1 commence en haut de page (option h1NewPage).
  // Une correction par passe, re-mesure, converge en quelques passes.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!editor) return
    if (localStorage.getItem('rapportcreator.nosync')) return
    const view = editor.view
    const dom = view.dom as HTMLElement
    let timer: ReturnType<typeof setTimeout> | null = null
    let passes = 0
    let calibrated = false
    let disposed = false

    const base = paginationConfig(settings)
    editor
      .chain()
      .updateMargins({
        top: base.marginTop,
        bottom: base.marginBottom,
        left: base.marginLeft,
        right: base.marginRight,
      })
      .updateHeaderContent(base.headerLeft, base.headerRight)
      .updateFooterContent(base.footerLeft, base.footerRight)
      .run()
    if (base.customHeader[1]) editor.commands.updateHeaderContent('', '', 1)

    const schedule = (delay = 350) => {
      if (disposed) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(pass, delay)
    }

    const debug = (...args: unknown[]) => {
      if (localStorage.getItem('rapportcreator.debug')) console.debug('[pagesync]', ...args)
    }

    // Cibles dans le document ProseMirror (source fiable, indépendante des
    // éléments décoratifs que l'extension insère dans le DOM).
    const collectTargets = () => {
      const out: { from: number; to: number; kind: 'break' | 'fill' }[] = []
      let index = 0
      view.state.doc.forEach((node, offset) => {
        const isH1 = node.type.name === 'heading' && node.attrs.level === 1
        const isToc =
          node.type.name === 'paragraph' && node.textContent.trim().toUpperCase() === '[TOC]'
        if (isH1 && settings.h1NewPage && index > 0) {
          out.push({ from: offset, to: offset + node.nodeSize, kind: 'break' })
        } else if (isToc) {
          out.push({ from: offset, to: offset + node.nodeSize, kind: 'fill' })
        }
        index++
      })
      return out
    }

    const measureBreakers = () =>
      Array.from(dom.querySelectorAll<HTMLElement>('.rm-page-break .breaker')).map((b) =>
        b.getBoundingClientRect()
      )

    const pass = () => {
      if (disposed || !editor || editor.isDestroyed) return
      if (passes++ > 20) {
        debug('garde-fou passes atteint')
        return
      }

      // les ancres du PDF pilotent les bandes : la géométrie historique
      // (calibration, paddings [TOC]/Titre 1) ne doit pas la concurrencer
      if (servoActiveRef.current) return

      const targets = collectTargets()
      if (targets.length === 0) return

      const breakers = measureBreakers()
      if (breakers.length === 0) return

      // 1. calibration de la zone de contenu (une seule fois)
      if (breakers.length >= 2 && !calibrated) {
        calibrated = true
        const m = pageMarginsMm(settings)
        const measured = breakers[1].top - breakers[0].bottom
        const target = (297 - m.top - m.bottom) * MM_TO_PX
        const diff = Math.round(measured - target)
        debug('calibration: mesuré', Math.round(measured), 'cible', Math.round(target), 'diff', diff)
        if (Math.abs(diff) > 3) {
          editor.commands.updateMargins({
            top: base.marginTop + diff,
            bottom: base.marginBottom,
            left: base.marginLeft,
            right: base.marginRight,
          })
          schedule(600)
          return
        }
      }

      // 2. calcul ABSOLU du padding de chaque cible dans la mise en page
      // courante : le haut de boîte (r.top) ne dépend pas du padding propre
      // de l'élément, donc pad = (début de page suivant) - r.top, recalculé
      // de zéro à chaque passe (gère aussi le rétrécissement du contenu).
      // On ne dispatch que si un pad a réellement changé.
      const pageStarts = breakers.map((b) => b.bottom)
      const specs: PageSyncSpec[] = []
      let changed = false
      for (const t of targets) {
        const el = view.nodeDOM(t.from)
        if (!(el instanceof HTMLElement)) continue
        const cs = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        if (t.kind === 'break') {
          const curPad = parseFloat(cs.paddingTop) || 0
          // premier début de page au niveau ou sous le haut de boîte
          const start = pageStarts.find((p) => p >= r.top - 3)
          if (start === undefined) {
            if (curPad > 0) changed = true
            continue
          }
          const pad = Math.max(0, Math.round(start - r.top))
          if (pad > 2) specs.push({ from: t.from, to: t.to, style: `padding-top:${pad}px` })
          if (Math.abs(pad - curPad) > 2) changed = true
        } else {
          const curPad = parseFloat(cs.paddingBottom) || 0
          const naturalBottom = r.bottom - curPad
          const band = breakers.find((b) => b.top >= naturalBottom - 3)
          const pad = band ? Math.max(0, Math.round(band.top - naturalBottom)) : 0
          specs.push({
            from: t.from,
            to: t.to,
            class: 'toc-placeholder',
            ...(pad > 2 ? { style: `padding-bottom:${pad}px` } : {}),
          })
          if (Math.abs(pad - curPad) > 2) changed = true
        }
        // une seule correction géométrique par passe : les cibles suivantes
        // seront re-mesurées après application (leurs positions dépendent
        // de celle-ci)
        if (changed) break
      }

      if (!changed) {
        debug('toutes les cibles alignées')
        return
      }
      // conserver les pads actuels des cibles non traitées dans cette passe
      for (const t of targets) {
        if (specs.some((sp) => sp.from === t.from)) continue
        const el = view.nodeDOM(t.from)
        if (!(el instanceof HTMLElement)) continue
        const cs = getComputedStyle(el)
        const pad =
          t.kind === 'break' ? parseFloat(cs.paddingTop) || 0 : parseFloat(cs.paddingBottom) || 0
        const style =
          pad > 2 ? `padding-${t.kind === 'break' ? 'top' : 'bottom'}:${Math.round(pad)}px` : undefined
        specs.push({
          from: t.from,
          to: t.to,
          ...(style ? { style } : {}),
          ...(t.kind === 'fill' ? { class: 'toc-placeholder' } : {}),
        })
      }
      debug('application de', specs.length, 'décorations')
      view.dispatch(view.state.tr.setMeta(pageSyncKey, specs))
      schedule(700) // passe suivante : cible suivante ou contrôle final
    }

    const onUpdate = () => {
      passes = 0
      schedule(450)
    }
    editor.on('update', onUpdate)

    // re-passe quand l'extension ajoute ou retire des pages
    const widget = dom.querySelector('[data-rm-pagination]')
    const mo = new MutationObserver(() => schedule())
    if (widget) mo.observe(widget, { childList: true })

    schedule(600)

    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      editor.off('update', onUpdate)
      mo.disconnect()
    }
  }, [editor, settings])

  // ------------------------------------------------------------------
  // Pied de page « page / total » — TOUJOURS le nombre de pages de l'ÉDITEUR
  // (jamais celui du moteur PDF : un « 21 / 18 » incohérent détruit la
  // confiance). L'extension ne substitue pas {total}, updateFooterContent à
  // chaud casse son {page}, et toute mutation DOM des pieds déclenche son
  // observateur (boucle → gel) : seule voie sûre, un ::after CSS dans <head>.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom as HTMLElement
    const totalStyle = document.createElement('style')
    document.head.appendChild(totalStyle)
    let last = -1
    let raf: ReturnType<typeof setTimeout> | null = null
    const sync = () => {
      raf = null
      const n = dom.querySelectorAll('.rm-page-break').length
      if (!settings.pageNumbers || n < 1 || n === last) return
      last = n
      totalStyle.textContent = `.rm-page-footer-right::after { content: " / ${n}"; }`
    }
    const schedule = () => {
      if (!raf) raf = setTimeout(sync, 120)
    }
    const mo = new MutationObserver(schedule)
    mo.observe(dom, { childList: true, subtree: true })
    // l'observateur peut manquer la reconstruction du widget de pagination :
    // re-vérifier aussi à chaque frappe et par filet périodique (le compteur
    // ne doit JAMAIS rester incohérent plus d'une seconde)
    editor.on('update', schedule)
    const tick = setInterval(schedule, 1000)
    sync()
    return () => {
      mo.disconnect()
      editor.off('update', schedule)
      clearInterval(tick)
      if (raf) clearTimeout(raf)
      totalStyle.remove()
    }
  }, [editor, settings.pageNumbers])

  // ------------------------------------------------------------------
  // Asservissement aux ancres du PDF. Modèle : le ruban de contenu coule
  // autour des bandes (la position d'une ligne ne dépend pas de celle des
  // bandes), alors que la bande N est positionnée rigidement par la somme des
  // margin-top des espaceurs 1..N. Pour chaque page, l'ancre {bloc, pixels
  // consommés} donne la coupure réelle du PDF ; deux mécanismes la
  // reproduisent :
  //  - le PDF coupe PLUS TÔT que la géométrie (sommaire pleine page, titre
  //    poussé, bloc insécable…) → marge sur le bloc d'ancre qui le cale sous
  //    la bande, laissée à sa hauteur nominale A4 (le blanc de fin de page
  //    reproduit celui du PDF) ;
  //  - le PDF coupe PLUS TARD (son rendu est un peu plus compact) → la bande
  //    descend juste au-dessus de l'ancre.
  // Une coupure en PLEIN bloc impose sa position à la bande. Les effets de
  // second ordre sont résorbés par re-mesure sur quelques passes.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!editor) return
    if (localStorage.getItem('rapportcreator.nosync')) return
    const view = editor.view
    const dom = view.dom as HTMLElement

    if (!bandStyleRef.current) {
      bandStyleRef.current = document.createElement('style')
      document.head.appendChild(bandStyleRef.current)
    }
    const styleEl = bandStyleRef.current
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let passes = 0
    let waits = 0

    const debug = (...args: unknown[]) => {
      if (localStorage.getItem('rapportcreator.debug')) console.debug('[servo]', ...args)
    }

    const deactivate = (reason: string) => {
      if (servoActiveRef.current) {
        servoActiveRef.current = false
        styleEl.textContent = ''
        // retirer AUSSI les calages : un margin-top de calage orphelin creuse
        // des trous géants en plein contenu une fois les bandes par défaut
        view.dispatch(view.state.tr.setMeta(pageSyncKey, []))
        debug('désactivé :', reason)
      }
    }

    if (!anchors || anchors.pages.length === 0) {
      deactivate('pas d’ancres')
      return
    }

    const m = pageMarginsMm(settings)
    const nominal = (297 - m.top - m.bottom) * MM_TO_PX

    const schedule = (delay: number) => {
      if (disposed) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(pass, delay)
    }

    const pass = () => {
      if (disposed || !editor || editor.isDestroyed) return

      // RÈGLE D'OR (stabilité type Word) : ne JAMAIS recaler pendant que
      // l'utilisateur édite — les bandes restent figées, le texte coule
      // localement. On attend le calme, puis UN règlement fluide.
      if (Date.now() - lastEditRef.current < 1200) {
        schedule(600)
        return
      }
      // une édition postérieure à ces ancres les périme : on garde le cadre
      // figé et on attend les ancres fraîches (elles relanceront l'effet)
      if (editedSinceAnchors) {
        debug('ancres périmées par une édition — attente des fraîches')
        return
      }

      // blocs de premier niveau du document → éléments DOM mesurables
      const blocks: { from: number; to: number; node: (typeof view.state.doc)['firstChild'] }[] =
        []
      view.state.doc.forEach((node, offset) => {
        blocks.push({ from: offset, to: offset + node.nodeSize, node })
      })
      // structure différente de celle paginée par le PDF (sommaire injecté
      // sans marqueur, désynchronisation passagère…) : on NE casse PAS le
      // cadre en place (les bandes actuelles restent des pages stables) — on
      // attend simplement des ancres qui correspondent
      if (blocks.length !== anchors.blocks) {
        debug(`blocs ${blocks.length} ≠ ${anchors.blocks} — cadre conservé`)
        return
      }
      const blockEls = blocks.map(({ from }) => {
        const el = view.nodeDOM(from)
        return el instanceof HTMLElement ? el : null
      })
      const blockRects = blockEls.map((el) => el?.getBoundingClientRect() ?? null)

      const breaks = Array.from(
        dom.querySelectorAll<HTMLElement>('[data-rm-pagination] > .rm-page-break')
      )
      if (breaks.length === 0) {
        if (waits++ < 25) schedule(400) // pagination pas encore montée
        return
      }
      // garde-fou anti-emballement : si l'éditeur fabrique beaucoup plus de
      // pages que le PDF, un bloc est coincé dans une géométrie dégénérée —
      // retour immédiat à la géométrie par défaut plutôt que l'infini
      if (breaks.length > anchors.pages.length + 8) {
        deactivate(`emballement: ${breaks.length} bandes pour ${anchors.pages.length} pages PDF`)
        return
      }
      servoActiveRef.current = true

      const rules: string[] = []
      const specs: PageSyncSpec[] = []
      const padded = new Set<number>()
      let cumBands = 0 // corrections de bandes déjà décidées (elles déplacent les bandes suivantes)
      let cumContent = 0 // marges de calage déjà décidées (elles déplacent le contenu suivant)
      let maxCorrection = 0
      // début de la zone de contenu de la page courante (page 1 : haut du 1er bloc)
      let pageStart = blockRects[0] ? blockRects[0].top : dom.getBoundingClientRect().top
      const nPages = Math.min(anchors.pages.length, breaks.length + 1)

      for (let N = 1; N < nPages; N++) {
        const spacer = breaks[N - 1].querySelector<HTMLElement>(':scope > .page')
        const breaker = breaks[N - 1].querySelector<HTMLElement>(':scope > .breaker')
        if (!spacer || !breaker) break
        const bRect = breaker.getBoundingClientRect()
        const bandTopNow = bRect.top + cumBands
        const curMt = parseFloat(getComputedStyle(spacer).marginTop) || 0
        const idealTop = pageStart + nominal
        let targetTop = idealTop

        const a = anchors.pages[N] // ancre du début de la page N+1
        const r = a ? blockRects[a.b] : null
        const el = a ? blockEls[a.b] : null
        if (a && r && el) {
          if (a.y > 4) {
            // Coupure en plein bloc : bande posée à cutY + 1 — elle chevauche
            // d'un pixel la PREMIÈRE ligne de la page suivante (qui passe
            // dessous), sans toucher la dernière ligne de la page courante
            // (à cutY − 1, l'arrondi pousserait une ligne de trop).
            const blockTop = r.top + cumContent
            targetTop = blockTop + Math.min(a.y, Math.max(0, r.height - 4)) + 1
          } else {
            // Le haut MESURÉ du bloc est trompeur (il peut déjà être poussé
            // par une bande ou calé) : tout se calcule depuis la fin du
            // contenu précédent, mesure stable d'une passe à l'autre.
            const curPad = parseFloat(el.dataset.wsPad || '0') || 0
            const prevRect = a.b > 0 ? blockRects[a.b - 1] : null
            const prevEnd = prevRect
              ? prevRect.bottom + cumContent
              : r.top + cumContent - curPad
            if (prevEnd + 28 < idealTop) {
              // le PDF coupe plus tôt que la géométrie : bande à la hauteur
              // nominale A4 et bloc calé dessous — le blanc de fin de page
              // reproduit celui du PDF
              targetTop = idealTop
              const wantPad = Math.max(0, Math.round(idealTop + bRect.height + 2 - prevEnd))
              if (wantPad > 2) {
                padded.add(a.b)
                specs.push({
                  from: blocks[a.b].from,
                  to: blocks[a.b].to,
                  style: `margin-top:${wantPad}px`,
                  pad: wantPad,
                })
                if (Math.abs(wantPad - curPad) > 3) {
                  maxCorrection = Math.max(maxCorrection, Math.abs(wantPad - curPad))
                }
                cumContent += wantPad - curPad
              } else if (curPad > 2) {
                cumContent -= curPad
                maxCorrection = Math.max(maxCorrection, curPad)
              }
            } else {
              // le PDF coupe pareil ou plus tard (son rendu est plus
              // compact) : bande juste après le contenu précédent, au plus
              // près de la hauteur nominale — le bloc d'ancre passe dessous
              // par le flot (pleine largeur), sans calage
              if (curPad > 2) {
                cumContent -= curPad // le calage n'a plus lieu d'être
                maxCorrection = Math.max(maxCorrection, curPad)
              }
              targetTop = Math.max(idealTop, prevEnd + 2)
            }
          }
        }

        // Bornes de sécurité : jamais de page plus courte que 30 % du nominal
        // (une page minuscule ne peut accueillir aucun bloc insécable → les
        // blocs cascadent sous toutes les bandes = croissance infinie), ni
        // plus haute que 160 %.
        targetTop = Math.max(pageStart + nominal * 0.3, Math.min(pageStart + nominal * 1.6, targetTop))
        const delta = targetTop - bandTopNow
        const next = Math.round(curMt + delta)
        if (Math.abs(delta) > 2) maxCorrection = Math.max(maxCorrection, Math.abs(delta))
        rules.push(
          `.rm-with-pagination .rm-page-break:nth-child(${N}) > .page { margin-top: ${next}px !important; }`
        )
        cumBands += next - curMt
        pageStart = bRect.bottom + cumBands // début de la page N+1
      }

      // habillage du marqueur [TOC] (page dédiée dans le PDF)
      for (const b of blocks) {
        if (
          b.node?.type.name === 'paragraph' &&
          b.node.textContent.trim().toUpperCase() === '[TOC]'
        ) {
          const existing = specs.find((s) => s.from === b.from)
          if (existing) existing.class = `${existing.class ?? ''} toc-placeholder`.trim()
          else specs.push({ from: b.from, to: b.to, class: 'toc-placeholder' })
        }
      }

      // Application avec ANCRAGE DU POINT DE VUE : la ligne du curseur (ou, si
      // l'éditeur n'a pas le focus, le contenu en haut de l'écran) reste au
      // même endroit à l'écran — le règlement est invisible pour l'œil.
      const css = rules.join('\n')
      const willApply = css !== styleEl.textContent || maxCorrection > 2
      let anchorPos: number | null = null
      let anchorTopBefore = 0
      if (willApply) {
        try {
          if (view.hasFocus()) {
            anchorPos = view.state.selection.from
          } else {
            const sc = dom.closest('.doc-scroll')
            const r = sc?.getBoundingClientRect()
            anchorPos = r
              ? (view.posAtCoords({ left: r.left + r.width / 2, top: r.top + 30 })?.pos ?? null)
              : null
          }
          if (anchorPos != null) anchorTopBefore = view.coordsAtPos(anchorPos).top
        } catch {
          anchorPos = null
        }
      }
      if (css !== styleEl.textContent) styleEl.textContent = css
      if (maxCorrection > 2) {
        view.dispatch(view.state.tr.setMeta(pageSyncKey, specs))
      }
      if (willApply && anchorPos != null) {
        const pos = anchorPos
        const before = anchorTopBefore
        requestAnimationFrame(() => {
          try {
            const scroller = dom.closest('.doc-scroll')
            if (!scroller) return
            const after = view.coordsAtPos(pos).top
            if (Math.abs(after - before) > 1) scroller.scrollTop += after - before
          } catch {
            /* position disparue : pas de compensation */
          }
        })
      }
      debug(
        `passe ${passes + 1} : ${rules.length} bandes, ${specs.length} calages, correction max ${Math.round(maxCorrection)}px`
      )
      // re-mesure rapprochée : la convergence complète se joue en < 1 s, comme
      // UN règlement fluide, pas une série de sauts espacés
      if (maxCorrection > 2 && passes++ < 14) schedule(90)
    }

    // Toute édition postérieure à l'arrivée de ces ancres les périme : on ne
    // recale JAMAIS sur des mesures d'un document qui n'existe plus (c'était
    // la source du « tout bouge pendant que j'écris »).
    let editedSinceAnchors = false
    const onUpdate = () => {
      editedSinceAnchors = true
    }
    editor.on('update', onUpdate)

    schedule(60)
    return () => {
      disposed = true
      editor.off('update', onUpdate)
      if (timer) clearTimeout(timer)
    }
  }, [editor, anchors, settings])

  // le style des bandes survit d'une livraison d'ancres à l'autre (pas de
  // saut visuel entre deux paginations) — retiré seulement au démontage
  useEffect(
    () => () => {
      bandStyleRef.current?.remove()
      bandStyleRef.current = null
      servoActiveRef.current = false
    },
    []
  )

  const active = useEditorState({
    editor,
    selector: ({ editor }: { editor: Editor | null }) => {
      if (!editor) return null
      return {
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        underline: editor.isActive('underline'),
        strike: editor.isActive('strike'),
        code: editor.isActive('code'),
        h1: editor.isActive('heading', { level: 1 }),
        h2: editor.isActive('heading', { level: 2 }),
        h3: editor.isActive('heading', { level: 3 }),
        bulletList: editor.isActive('bulletList'),
        orderedList: editor.isActive('orderedList'),
        blockquote: editor.isActive('blockquote'),
        codeBlock: editor.isActive('codeBlock'),
        canUndo: editor.can().undo(),
        canRedo: editor.can().redo(),
      }
    },
  })

  // Ctrl+F / Ctrl+H : barre Rechercher / Remplacer flottante
  const [find, setFind] = useState<{ open: boolean; withReplace: boolean }>({
    open: false,
    withReplace: false,
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        setFind({ open: true, withReplace: false })
      } else if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault()
        setFind({ open: true, withReplace: true })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const insertImage = useCallback(() => fileInputRef.current?.click(), [])

  const onImagePicked = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file && editor) {
        const dataUrl = await fileToDataUrl(file)
        let src = dataUrl
        if (desktop && assetRoot) {
          const rel = await desktop.saveAsset({ projectPath: assetRoot, dataUrl })
          if (rel) src = assetUrl(assetRoot, rel)
        }
        editor.chain().focus().setImage({ src }).run()
      }
      e.target.value = ''
    },
    [editor, assetRoot]
  )

  const setLink = useCallback(() => {
    if (!editor) return
    const prev = (editor.getAttributes('link').href as string) ?? ''
    const url = window.prompt('Adresse du lien :', prev)
    if (url === null) return
    if (url === '') editor.chain().focus().unsetLink().run()
    else editor.chain().focus().setLink({ href: url }).run()
  }, [editor])

  if (!editor) return null

  const headingValue = active?.h1 ? '1' : active?.h2 ? '2' : active?.h3 ? '3' : 'p'

  return (
    <div className="doc-editor">
      <style>{reportTypographyCss(settings, '.doc-page-canvas')}</style>
      <div className="doc-toolbar">
        <button
          className="tb-btn"
          title="Annuler (Ctrl+Z)"
          disabled={!active?.canUndo}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Icon name="undo" />
        </button>
        <button
          className="tb-btn"
          title="Rétablir (Ctrl+Y)"
          disabled={!active?.canRedo}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Icon name="redo" />
        </button>
        <span className="tb-sep" />
        <select
          className="tb-select"
          title="Style de paragraphe"
          value={headingValue}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'p') editor.chain().focus().setParagraph().run()
            else editor.chain().focus().setHeading({ level: Number(v) as 1 | 2 | 3 }).run()
          }}
        >
          <option value="p">Texte normal</option>
          <option value="1">Titre 1</option>
          <option value="2">Titre 2</option>
          <option value="3">Titre 3</option>
        </select>
        <span className="tb-sep" />
        <button
          className={`tb-btn ${active?.bold ? 'is-active' : ''}`}
          title="Gras (Ctrl+B)"
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Icon name="bold" />
        </button>
        <button
          className={`tb-btn ${active?.italic ? 'is-active' : ''}`}
          title="Italique (Ctrl+I)"
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Icon name="italic" />
        </button>
        <button
          className={`tb-btn ${active?.underline ? 'is-active' : ''}`}
          title="Souligné (Ctrl+U)"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <Icon name="underline" />
        </button>
        <button
          className={`tb-btn ${active?.strike ? 'is-active' : ''}`}
          title="Barré"
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Icon name="strikethrough" />
        </button>
        <button
          className={`tb-btn ${active?.code ? 'is-active' : ''}`}
          title="Code en ligne"
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          <Icon name="code" />
        </button>
        <span className="tb-sep" />
        <button
          className={`tb-btn ${active?.bulletList ? 'is-active' : ''}`}
          title="Liste à puces"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <Icon name="list" />
        </button>
        <button
          className={`tb-btn ${active?.orderedList ? 'is-active' : ''}`}
          title="Liste numérotée"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <Icon name="list-ordered" />
        </button>
        <button
          className={`tb-btn ${active?.blockquote ? 'is-active' : ''}`}
          title="Citation"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Icon name="quote" size={14} />
        </button>
        <button
          className={`tb-btn ${active?.codeBlock ? 'is-active' : ''}`}
          title="Bloc de code"
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <Icon name="code-block" />
        </button>
        <span className="tb-sep" />
        <button className="tb-btn" title="Insérer un lien" onClick={setLink}>
          <Icon name="link" />
        </button>
        <button className="tb-btn" title="Insérer une image" onClick={insertImage}>
          <Icon name="image" />
        </button>
        <button
          className="tb-btn"
          title="Insérer un tableau 3×3"
          onClick={() =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
        >
          <Icon name="table" />
        </button>
        <button
          className="tb-btn"
          title="Ligne horizontale"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        >
          <Icon name="minus" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={onImagePicked}
        />
      </div>
      <div className="doc-scroll">
        <div className="doc-page-canvas" style={{ width: Math.round(210 * MM_TO_PX) }}>
          <EditorContent editor={editor} />
        </div>
      </div>
      {find.open && (
        <FindBar
          editor={editor}
          withReplace={find.withReplace}
          onClose={() => setFind({ open: false, withReplace: false })}
        />
      )}
    </div>
  )
}
