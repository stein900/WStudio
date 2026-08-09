import { useEffect, useRef, useState } from 'react'
import { buildPagedHtml, type PagedAnchors } from '../lib/exportPdf'
import { desktop } from '../lib/desktop'
import type { PageSettings } from '../types'

interface Props {
  markdown: string
  settings: PageSettings
  title: string
  /** Dossier du projet (résolution des images assets/) ; absent en navigateur. */
  projectPath?: string
  /** Reçoit une fonction donnant l'id du webContents de la face VISIBLE de
   * l'aperçu (export PDF fidèle) ; null hors bureau ou si indisponible. */
  exportIdRef?: React.MutableRefObject<(() => number | null) | null>
  /** Ancres de coupure mesurées à chaque pagination (asservissement du mode
   * Document aux pages réelles du PDF) ; null si la mesure a échoué. */
  onAnchors?: (anchors: PagedAnchors | null) => void
}

/**
 * Débounce adaptatif : sur un gros document, la mise en page coûte cher —
 * on attend d'autant plus longtemps que le document est long avant de
 * relancer une pagination, pour ne jamais l'exécuter en pleine frappe.
 */
function debounceFor(length: number): number {
  return Math.min(3500, 900 + Math.floor(length / 40))
}

/**
 * Bascule de thème à chaud : pousse la classe ws-dark (habillage écran du
 * document d'aperçu) dans les faces déjà paginées — aucune repagination.
 * Les paginations suivantes embarquent la classe dès la construction du HTML.
 */
function useThemeSync(apply: (dark: boolean) => void) {
  const applyRef = useRef(apply)
  applyRef.current = apply
  useEffect(() => {
    const obs = new MutationObserver(() =>
      applyRef.current(document.documentElement.dataset.theme === 'dark')
    )
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
}

/** Surface minimale du <webview> Electron utilisée ici. */
interface PreviewWebview extends HTMLElement {
  src: string
  executeJavaScript(code: string): Promise<unknown>
  getWebContentsId(): number
}

interface ConsoleMessageEvent extends Event {
  message?: string
}

function StatusBadge({ busy, pages }: { busy: boolean; pages: number | null }) {
  return (
    <div className="paged-preview-status">
      {busy ? (
        <span className="paged-badge paged-badge-busy">
          <span className="mini-spinner" /> Mise en page…
        </span>
      ) : pages !== null ? (
        <span className="paged-badge">
          {pages} page{pages > 1 ? 's' : ''}
        </span>
      ) : null}
    </div>
  )
}

/**
 * Aperçu de bureau : deux <webview> en double tampon. Chaque webview vit dans
 * son PROPRE processus — la pagination Paged.js d'un gros document n'y gèle
 * plus jamais la frappe dans l'éditeur. Le HTML est transmis par fichier
 * temporaire (IPC preview:write), la fin de pagination par console-message.
 */
function WebviewPreview({ markdown, settings, title, projectPath, exportIdRef, onAnchors }: Props) {
  const viewARef = useRef<PreviewWebview | null>(null)
  const viewBRef = useRef<PreviewWebview | null>(null)
  const [active, setActive] = useState<'A' | 'B'>('A')
  const activeRef = useRef<'A' | 'B'>('A')
  const [busy, setBusy] = useState(true)
  const [pages, setPages] = useState<number | null>(null)
  const generation = useRef(0)

  // callback ancres dans un ref : sa nouvelle identité à chaque rendu ne doit
  // pas relancer la pagination
  const onAnchorsRef = useRef(onAnchors)
  onAnchorsRef.current = onAnchors

  useThemeSync((dark) => {
    for (const ref of [viewARef, viewBRef]) {
      try {
        ref.current
          ?.executeJavaScript(`document.documentElement.classList.toggle('ws-dark', ${dark})`)
          .catch(() => {})
      } catch {
        /* face jamais chargée : la classe viendra avec sa première pagination */
      }
    }
  })

  // Export fidèle : exposer l'id du webContents de la face visible
  const pagesRef = useRef<number | null>(null)
  pagesRef.current = pages
  useEffect(() => {
    if (!exportIdRef) return
    exportIdRef.current = () => {
      if (pagesRef.current === null) return null // jamais paginé : rien à exporter
      const view = (activeRef.current === 'A' ? viewARef : viewBRef).current
      try {
        return view?.getWebContentsId() ?? null
      } catch {
        return null
      }
    }
    return () => {
      exportIdRef.current = null
    }
  }, [exportIdRef])

  useEffect(() => {
    const gen = ++generation.current
    setBusy(true)
    const t = setTimeout(async () => {
      let html: string
      try {
        html = await buildPagedHtml(markdown, settings, title, 'preview', projectPath)
      } catch {
        setBusy(false)
        return
      }
      if (gen !== generation.current) return

      const frontIsA = activeRef.current === 'A'
      const back = (frontIsA ? viewBRef : viewARef).current
      const front = (frontIsA ? viewARef : viewBRef).current
      if (!back || !front || !desktop) return

      const url = await desktop.writePreviewFile({ html, slot: frontIsA ? 'B' : 'A' })
      if (gen !== generation.current) return

      // les ancres arrivent sur une ligne console dédiée juste avant le signal
      // de fin — rattachées ici à la même génération de pagination
      let pendingAnchors: PagedAnchors | null = null
      const onConsole = (e: Event) => {
        const msg = (e as ConsoleMessageEvent).message ?? ''
        const am = /^\[paged-anchors\] (.+)$/.exec(msg)
        if (am) {
          try {
            pendingAnchors = JSON.parse(am[1]) as PagedAnchors
          } catch {
            pendingAnchors = null
          }
          return
        }
        const m = /^\[paged-done\] (\d+)/.exec(msg)
        if (!m) return
        back.removeEventListener('console-message', onConsole)
        if (gen !== generation.current) return
        void (async () => {
          // reprendre la position de lecture de l'ancienne face — borné par un
          // délai : executeJavaScript sur un webview jamais chargé (premier
          // échange) ne se résout jamais et suspendrait la bascule.
          try {
            const y = await Promise.race([
              front.executeJavaScript('window.scrollY'),
              new Promise((_, reject) => setTimeout(reject, 800)),
            ])
            await back.executeJavaScript(`window.scrollTo(0, ${Number(y) || 0})`)
          } catch {
            /* première pagination : pas de position à reprendre */
          }
          if (gen !== generation.current) return
          activeRef.current = frontIsA ? 'B' : 'A'
          setActive(activeRef.current)
          setPages(Number(m[1]) || null)
          setBusy(false)
          onAnchorsRef.current?.(pendingAnchors)
        })()
      }
      back.addEventListener('console-message', onConsole)
      back.src = `${url}?v=${gen}` // cache-busting : même fichier, contenu neuf
    }, debounceFor(markdown.length))
    return () => clearTimeout(t)
  }, [markdown, settings, title, projectPath])

  return (
    <div className="paged-preview">
      {/* backgroundThrottling=no : la face arrière est masquée pendant sa
          pagination ; sans cela Chromium suspend ses requestAnimationFrame
          et Paged.js reste bloqué à 0 page. */}
      <webview
        ref={viewARef as React.Ref<HTMLElement>}
        title="Aperçu paginé A"
        className="paged-preview-frame"
        webpreferences="backgroundThrottling=no"
        style={{ visibility: active === 'A' ? 'visible' : 'hidden' }}
      />
      <webview
        ref={viewBRef as React.Ref<HTMLElement>}
        title="Aperçu paginé B"
        className="paged-preview-frame"
        webpreferences="backgroundThrottling=no"
        style={{ visibility: active === 'B' ? 'visible' : 'hidden' }}
      />
      <StatusBadge busy={busy} pages={pages} />
    </div>
  )
}

/** Aperçu navigateur : iframes srcdoc en double tampon (comportement historique). */
function IframePreview({ markdown, settings, title, onAnchors }: Props) {
  const frameARef = useRef<HTMLIFrameElement>(null)
  const frameBRef = useRef<HTMLIFrameElement>(null)
  const [active, setActive] = useState<'A' | 'B'>('A')
  const activeRef = useRef<'A' | 'B'>('A')
  const [busy, setBusy] = useState(true)
  const [pages, setPages] = useState<number | null>(null)
  const generation = useRef(0)

  const onAnchorsRef = useRef(onAnchors)
  onAnchorsRef.current = onAnchors

  useThemeSync((dark) => {
    for (const ref of [frameARef, frameBRef]) {
      ref.current?.contentDocument?.documentElement.classList.toggle('ws-dark', dark)
    }
  })

  useEffect(() => {
    const gen = ++generation.current
    setBusy(true)
    const t = setTimeout(async () => {
      let html: string
      try {
        html = await buildPagedHtml(markdown, settings, title, 'preview')
      } catch {
        setBusy(false)
        return
      }
      if (gen !== generation.current) return

      const frontIsA = activeRef.current === 'A'
      const back = frontIsA ? frameBRef.current : frameARef.current
      const front = frontIsA ? frameARef.current : frameBRef.current
      if (!back || !front) return

      const onMessage = (e: MessageEvent) => {
        if (e.source !== back.contentWindow) return
        const data = e.data as { type?: string; pages?: number; anchors?: PagedAnchors | null }
        if (data?.type !== 'paged-done') return
        window.removeEventListener('message', onMessage)
        if (gen !== generation.current) return
        const y = front.contentWindow?.scrollY ?? 0
        back.contentWindow?.scrollTo(0, y)
        activeRef.current = frontIsA ? 'B' : 'A'
        setActive(activeRef.current)
        setPages(data.pages ?? null)
        setBusy(false)
        onAnchorsRef.current?.(data.anchors ?? null)
      }
      window.addEventListener('message', onMessage)
      back.srcdoc = html
    }, debounceFor(markdown.length))
    return () => clearTimeout(t)
  }, [markdown, settings, title])

  return (
    <div className="paged-preview">
      <iframe
        ref={frameARef}
        title="Aperçu paginé A"
        className="paged-preview-frame"
        style={{ visibility: active === 'A' ? 'visible' : 'hidden' }}
      />
      <iframe
        ref={frameBRef}
        title="Aperçu paginé B"
        className="paged-preview-frame"
        style={{ visibility: active === 'B' ? 'visible' : 'hidden' }}
      />
      <StatusBadge busy={busy} pages={pages} />
    </div>
  )
}

export function PagedPreview(props: Props) {
  return desktop ? <WebviewPreview {...props} /> : <IframePreview {...props} />
}
