import hljsCss from 'highlight.js/styles/github.css?inline'
import type { PageSettings } from '../types'

/**
 * Ancres de coupure mesurées dans le rendu Paged.js (source de vérité du PDF).
 * Pour chaque page : l'index du bloc de premier niveau qui la commence et le
 * nombre de pixels de ce bloc déjà consommés par les pages précédentes
 * (0 = la page commence en début de bloc). Le mode Document s'en sert pour
 * placer ses bandes de page exactement sur les coupures du PDF.
 */
export interface PagedAnchors {
  /** Nombre de blocs de premier niveau du document rendu (garde-fou de correspondance). */
  blocks: number
  /** Une entrée par page ; null si la page n'a pas de bloc identifiable. */
  pages: ({ b: number; y: number } | null)[]
}

// URL absolue : le HTML généré est aussi chargé hors de l'application
// (fenêtre cachée d'export d'Electron, où une URL relative ne résout pas).
const pagedPolyfillUrl = new URL(
  `${import.meta.env.BASE_URL}paged.polyfill.min.js`,
  document.baseURI
).href
const katexCssUrl = new URL(`${import.meta.env.BASE_URL}katex/katex.min.css`, document.baseURI)
  .href
import { resolveAssetsToFileUrls } from './assets'
import { desktop } from './desktop'
import { renderForExport, escapeHtml } from './markdown'
import { FONT_STACKS, pageMarginsMm, reportTypographyCss } from './reportTypography'

function buildPrintCss(s: PageSettings): string {
  const hasHeader = Boolean(s.headerText || s.headerLogo)
  const hasFooterText = Boolean(s.footerText)
  const m = pageMarginsMm(s)

  return `
:root { color-scheme: light; }
* { box-sizing: border-box; }

@page {
  size: A4;
  margin: ${m.top}mm ${m.side}mm ${m.bottom}mm ${m.side}mm;
  ${hasHeader ? '@top-center { content: element(pageHeader); }' : ''}
  ${hasFooterText ? '@bottom-left { content: element(pageFooter); }' : ''}
  ${
    s.pageNumbers
      ? `@bottom-right {
    content: counter(page) " / " counter(pages);
    font-family: ${FONT_STACKS[s.fontFamily]};
    font-size: 9pt;
    color: #555;
  }`
      : ''
  }
}

${
  hasHeader && !s.headerOnFirstPage
    ? `@page :first { margin-top: 20mm; @top-center { content: none; } }
/* filet : selon les versions, Paged.js clone quand même l'élément running
   sur la première page malgré le content:none du :first */
.pagedjs_first_page .pagedjs_margin-top-center .page-header { display: none !important; }`
    : ''
}

.page-header {
  position: running(pageHeader);
  /* largeur EXPLICITE (zone entre les coins de marge) : un pourcentage se
     résout en shrink-to-fit dans la boîte de marge à l'impression, ce qui
     recentre logo+texte collés — le mm est identique écran/impression. */
  width: ${210 - 2 * m.side}mm;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8mm;
  padding-bottom: 2mm;
  border-bottom: 0.4pt solid #b5b5b5;
  font-family: ${FONT_STACKS[s.fontFamily]};
  font-size: 9pt;
  color: #444;
}
.page-header img { height: 9mm; width: auto; }
.page-header .header-text { flex: 1; text-align: right; }
/* Paged.js force display:block sur le clone de l'élément running dans la
   boîte de marge — sans flex, logo et texte se retrouvent agglutinés au
   centre. Rétabli en !important (identique écran et impression). */
.pagedjs_margin-content .page-header { display: flex !important; }

.page-footer {
  position: running(pageFooter);
  font-family: ${FONT_STACKS[s.fontFamily]};
  font-size: 9pt;
  color: #555;
}

body { margin: 0; text-rendering: optimizeLegibility; }

/* Typographie partagée avec l'éditeur Document (même source = même pagination) */
${reportTypographyCss(s, '')}

/* --- Règles de coupure propres à l'impression --- */
h1, h2, h3, h4 { break-after: avoid; break-inside: avoid; }
${s.h1NewPage ? 'h1 { break-before: page; }' : ''}
h1:first-child { break-before: auto; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
/* Un tableau qui tient sur une page n'est jamais coupé : même politique que
   le mode Document (un tableau y est un bloc insécable — un contexte de
   formatage ne peut pas enjamber une bande). Plus haut qu'une page, Paged.js
   le coupe quand même (avoid impossible) — cas dégradé assumé des deux côtés. */
table { break-inside: avoid; }
/* pre : jamais overflow:hidden (bloc monolithique → éjecté par Paged.js) ;
   break-inside: avoid en indication (couper un pre coloré hljs en plein
   milieu fait caler Paged.js) ; les blocs longs (pre-long, marqués à
   l'export) se coupent normalement entre les pages. */
pre { overflow: visible; break-inside: avoid; }
pre.pre-long { break-inside: auto; }
.mermaid-diagram { break-inside: avoid; }
/* Équations LaTeX (KaTeX) : un bloc $$…$$ ne se coupe jamais entre deux pages */
.katex-display { break-inside: avoid; margin: 1em 0; }
.katex { font-size: 1.05em; }

/* Légendes : paragraphe en italique seul juste après figure/tableau */
em:only-child { color: #444; }

/* Sommaire */
.report-toc { break-after: page; margin: 1.5em 0; }
.report-toc-title { border-bottom: none; font-size: 16pt; }
.report-toc ul { list-style: none; padding: 0; margin: 0; }
.report-toc li { margin: 0; padding: 0.22em 0; }
.report-toc li.toc-level-3 { padding-left: 1.8em; font-size: ${s.fontSize - 1}pt; }
.report-toc a {
  color: #1a1a1a;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.8em;
}
.report-toc a::after {
  content: target-counter(attr(href), page);
  color: #333;
  font-variant-numeric: tabular-nums;
}
`
}

/**
 * Construit le document HTML autonome paginé par Paged.js.
 * mode 'print' : lance l'impression une fois la mise en page terminée.
 * mode 'preview' : style écran (pages détachées sur fond gris) et signale la
 * fin de pagination au parent via postMessage { type: 'paged-done', pages }.
 * mode 'pdf' : pose window.__pagedDone (lu par la fenêtre cachée d'Electron
 * qui convertit ensuite le document en PDF via printToPDF).
 */
export async function buildPagedHtml(
  markdown: string,
  settings: PageSettings,
  title: string,
  mode: 'print' | 'preview' | 'pdf',
  projectPath?: string
): Promise<string> {
  // images du projet : chemins relatifs assets/ → URLs file:// absolues (le
  // HTML généré est chargé depuis un fichier temporaire hors du projet)
  const source = projectPath ? resolveAssetsToFileUrls(markdown, projectPath) : markdown
  const contentHtml = await renderForExport(source, { forceToc: settings.autoToc })
  const m = pageMarginsMm(settings)

  const headerHtml =
    settings.headerText || settings.headerLogo
      ? `<div class="page-header">${
          settings.headerLogo ? `<img src="${settings.headerLogo}" alt="logo">` : ''
        }<span class="header-text">${escapeHtml(settings.headerText)}</span></div>`
      : ''

  const footerHtml = settings.footerText
    ? `<div class="page-footer">${escapeHtml(settings.footerText)}</div>`
    : ''

  // Thème de l'interface au moment de la construction ; la classe ws-dark ne
  // pilote que l'habillage écran ci-dessous (jamais l'impression). Les bascules
  // à chaud sont propagées par PagedPreview sans repagination.
  const uiDark =
    typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'

  const doc = `<!DOCTYPE html>
<html lang="fr"${uiDark ? ' class="ws-dark"' : ''}>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${katexCssUrl}">
<style>${hljsCss}</style>
<style>${buildPrintCss(settings)}</style>
<style>
/* Habillage ÉCRAN uniquement (fond, ombres, espace entre pages) — identique
   dans TOUS les modes et neutralisé à l'impression : le document d'aperçu et
   le document d'export sont strictement les mêmes, donc mêmes coupures. */
@media screen {
  html { background: #f5f5f7; }
  body { background: #f5f5f7; }
  html.ws-dark, html.ws-dark body { background: #1c1c1e; }
  .pagedjs_pages { display: flex; flex-direction: column; align-items: center; padding: 28px 8px 80px; }
  .pagedjs_page { background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.06), 0 18px 48px rgba(0,0,0,0.1); margin-bottom: 24px; border-radius: 2px; }
  html.ws-dark .pagedjs_page { box-shadow: 0 2px 8px rgba(0,0,0,0.4), 0 18px 48px rgba(0,0,0,0.5); }
}
</style>
<script>
  // Chromium cesse d'émettre des frames pour un guest non affiché (webview
  // masqué, fenêtre cachée) sans forcément passer visibilityState à 'hidden',
  // ce qui affame rAF/requestIdleCallback et bloque Paged.js à 0 page. Ces
  // API ne servent ici que de découpage temporel : timers dans tous les modes
  // (déterminisme identique aperçu/export).
  (function () {
    window.requestAnimationFrame = function (cb) {
      return setTimeout(function () { cb(performance.now()); }, 16);
    };
    window.cancelAnimationFrame = function (id) { clearTimeout(id); };
    window.requestIdleCallback = function (cb) {
      return setTimeout(function () {
        cb({ didTimeout: false, timeRemaining: function () { return 50; } });
      }, 1);
    };
    window.cancelIdleCallback = function (id) { clearTimeout(id); };
  })();
  // Ancres de coupure : chaque bloc de premier niveau du document source est
  // numéroté AVANT pagination (l'attribut survit au découpage en fragments par
  // Paged.js). Après pagination on mesure, page par page, quel bloc commence
  // la page et combien de pixels du bloc ont été consommés avant elle — le
  // mode Document aligne ses bandes sur ces mesures (fidélité par construction).
  window.__wsCollectAnchors = function () {
    var pages = document.querySelectorAll('.pagedjs_page');
    if (!pages.length) return null;
    var consumed = {};
    var out = [];
    for (var p = 0; p < pages.length; p++) {
      var area = pages[p].querySelector('.pagedjs_page_content');
      var frags = area ? area.querySelectorAll('[data-ws-block]') : [];
      if (!frags.length) { out.push(null); continue; }
      var b = parseInt(frags[0].getAttribute('data-ws-block'), 10);
      out.push({ b: b, y: Math.round(consumed[b] || 0) });
      for (var i = 0; i < frags.length; i++) {
        var idx = parseInt(frags[i].getAttribute('data-ws-block'), 10);
        consumed[idx] = (consumed[idx] || 0) + frags[i].getBoundingClientRect().height;
      }
    }
    return { blocks: window.__wsBlockCount || 0, pages: out };
  };
  window.PagedConfig = {
    // auto désactivé : la pagination ne démarre qu'une fois polices ET images
    // chargées — mesurer une image pas encore chargée décale les coupures et
    // rend l'aperçu infidèle au PDF.
    auto: false,
    after: () => {
      // Le hook peut se déclencher avant la fin réelle du rendu (démarrage
      // manuel) et son paramètre flow n'est pas fiable : attendre que le
      // nombre de pages du DOM soit STABLE avant de signaler.
      let last = -1;
      let tries = 0;
      const check = () => {
        const pages = document.querySelectorAll('.pagedjs_page').length;
        if ((pages > 0 && pages === last) || ++tries > 60) {
          const total = pages || 1;
          ${
            mode === 'print'
              ? 'setTimeout(() => window.print(), 200); void total;'
              : mode === 'pdf'
                ? 'window.__pagedDone = total;'
                : // iframe (navigateur) : postMessage ; <webview> (bureau) : l'hôte
                  // écoute l'événement console-message. Les ancres partent
                  // AVANT le signal de fin (l'hôte les rattache à cette passe).
                  `var anchors = null;
                  try { anchors = window.__wsCollectAnchors(); } catch (e) {}
                  if (anchors) console.log('[paged-anchors] ' + JSON.stringify(anchors));
                  parent.postMessage({ type: 'paged-done', pages: total, anchors: anchors }, '*');
                  console.log('[paged-done] ' + total);`
          }
          return;
        }
        last = pages;
        setTimeout(check, 250);
      };
      setTimeout(check, 120);
    },
  };
  window.addEventListener('load', function () {
    Promise.resolve(document.fonts && document.fonts.ready)
      .catch(function () {})
      .then(function () {
        // numérotation des blocs source pour les ancres de coupure
        var rootEl = document.querySelector('main.report');
        if (rootEl) {
          for (var bi = 0; bi < rootEl.children.length; bi++) {
            rootEl.children[bi].setAttribute('data-ws-block', String(bi));
          }
          window.__wsBlockCount = rootEl.children.length;
        }
        // Équations plus larges que la zone de contenu : réduction
        // homothétique AVANT pagination (zoom affecte la mise en page),
        // identique dans tous les modes → parité aperçu/PDF conservée.
        var limit = ${210 - 2 * m.side} * (96 / 25.4) - 4;
        document.querySelectorAll('.katex-display > .katex').forEach(function (k) {
          if (k.scrollWidth > limit) {
            k.style.zoom = String(Math.max(0.45, limit / k.scrollWidth));
          }
        });
        window.PagedPolyfill.preview();
      });
  });
  window.addEventListener('afterprint', () => parent.postMessage('rapport-print-done', '*'));
<\/script>
<script src="${pagedPolyfillUrl}"><\/script>
</head>
<body>
${headerHtml}
${footerHtml}
<main class="report">${contentHtml}</main>
</body>
</html>`

  return doc
}

/**
 * Exporte le rapport en PDF.
 * Dans l'application de bureau : boîte de dialogue native puis écriture
 * directe du fichier PDF (printToPDF de Chromium, aucune boîte d'impression).
 * Dans un navigateur : boîte d'impression, « Enregistrer au format PDF ».
 */
export async function exportToPdf(
  markdown: string,
  settings: PageSettings,
  title: string,
  projectPath?: string
): Promise<void> {
  if (desktop) {
    const html = await buildPagedHtml(markdown, settings, title, 'pdf', projectPath)
    await desktop.exportPdf({ html, suggestedName: `${title.replace(/[^\wÀ-ſ -]/g, '')}.pdf` })
    return
  }

  const doc = await buildPagedHtml(markdown, settings, title, 'print')

  await new Promise<void>((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.title = 'Export PDF'
    iframe.style.cssText =
      'position:fixed;top:0;left:-9999px;width:230mm;height:300mm;border:0;visibility:hidden;'
    document.body.appendChild(iframe)

    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      iframe.remove()
      resolve()
    }
    const onMessage = (e: MessageEvent) => {
      if (e.data === 'rapport-print-done') cleanup()
    }
    window.addEventListener('message', onMessage)
    // Filet de sécurité si afterprint ne remonte pas
    setTimeout(cleanup, 120_000)

    iframe.srcdoc = doc
  })
}
