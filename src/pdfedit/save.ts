/**
 * Enregistrement du PDF modifié (pdf-lib) : chaque fragment édité est
 * recouvert d'un rectangle de la couleur du fond, puis le nouveau texte est
 * redessiné sur la même ligne de base avec une police standard assortie
 * (famille, graisse et italique approchées depuis la police d'origine).
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { PDFFont, RGB } from 'pdf-lib'
import type { Annot, TextEdit } from './types'

function hexRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

/** Police standard la plus proche du nom de police d'origine. */
function matchFont(fontName: string): StandardFonts {
  const n = fontName.toLowerCase()
  const bold = /bold|black|heavy|semibold|demi/.test(n)
  const italic = /italic|oblique/.test(n)
  if (/courier|mono|consolas/.test(n)) {
    if (bold && italic) return StandardFonts.CourierBoldOblique
    if (bold) return StandardFonts.CourierBold
    if (italic) return StandardFonts.CourierOblique
    return StandardFonts.Courier
  }
  if (/times|georgia|garamond|book|serif|roman|cambria/.test(n) && !/sans/.test(n)) {
    if (bold && italic) return StandardFonts.TimesRomanBoldItalic
    if (bold) return StandardFonts.TimesRomanBold
    if (italic) return StandardFonts.TimesRomanItalic
    return StandardFonts.TimesRoman
  }
  if (bold && italic) return StandardFonts.HelveticaBoldOblique
  if (bold) return StandardFonts.HelveticaBold
  if (italic) return StandardFonts.HelveticaOblique
  return StandardFonts.Helvetica
}

/**
 * Les polices standard sont limitées à l'encodage WinAnsi (qui couvre le
 * français : accents, œ, €, guillemets…). Les caractères hors encodage sont
 * remplacés pour ne jamais faire échouer l'enregistrement.
 */
function encodable(text: string, font: PDFFont): string {
  let out = ''
  for (const ch of text) {
    if (ch === '\n') {
      out += ch // saut de ligne : géré par lineHeight, pas par la police
      continue
    }
    try {
      font.widthOfTextAtSize(ch, 10)
      out += ch
    } catch {
      out += '?'
    }
  }
  return out
}

/** Applique toutes les modifications et renvoie les octets du nouveau PDF. */
export async function saveEditedPdf(
  original: ArrayBuffer,
  edits: TextEdit[],
  annots: Annot[] = []
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original, { ignoreEncryption: true })
  const fonts = new Map<StandardFonts, PDFFont>()
  const embed = async (name: StandardFonts): Promise<PDFFont> => {
    let f = fonts.get(name)
    if (!f) {
      f = await doc.embedFont(name)
      fonts.set(name, f)
    }
    return f
  }

  for (const edit of edits) {
    const page = doc.getPage(edit.span.pageIndex)
    const s = edit.span

    // Recouvre uniquement l'encre des glyphes d'origine (edit.cover, détectée
    // sur le rendu) : les filets de tableau qui frôlent le texte survivent.
    page.drawRectangle({
      x: edit.cover.x,
      y: edit.cover.y,
      width: edit.cover.width,
      height: edit.cover.height,
      color: rgb(edit.bg.r / 255, edit.bg.g / 255, edit.bg.b / 255),
    })

    const value = edit.text.trim() ? edit.text : ''
    if (!value) continue // effacement pur : le rectangle suffit

    const font = await embed(matchFont(s.fontName))
    const text = encodable(value, font)
    let size = s.height
    // Texte plus long que l'original : il s'étire dans l'espace libre à
    // droite (edit.maxWidth, borné par le texte voisin sur la même ligne ou
    // le bord de page) — réduit seulement au-delà.
    const w = font.widthOfTextAtSize(text, size)
    const maxW = Math.max(edit.maxWidth || 0, s.width)
    if (w > maxW && w > 0) size = (size * maxW) / w

    page.drawText(text, { x: s.x, y: s.y, size, font, color: rgb(0, 0, 0) })
  }

  // Ajouts par-dessus le contenu : images puis formes, dans l'ordre de pose
  for (const a of annots) {
    const page = doc.getPage(a.pageIndex)
    const r = a.rect
    if (a.kind === 'image') {
      const img =
        a.mime === 'image/jpeg' ? await doc.embedJpg(a.bytes) : await doc.embedPng(a.bytes)
      page.drawImage(img, { x: r.x, y: r.y, width: r.width, height: r.height })
    } else if (a.kind === 'text') {
      if (!a.text.trim()) continue
      const font = await embed(StandardFonts.Helvetica)
      // Ligne de base de la première ligne juste sous le haut de la boîte ;
      // les lignes suivantes descendent (interligne 1,25 — comme l'aperçu).
      page.drawText(encodable(a.text, font), {
        x: r.x + 1,
        y: r.y + r.height - a.fontSize * 0.95,
        size: a.fontSize,
        font,
        color: hexRgb(a.color),
        lineHeight: a.fontSize * 1.25,
      })
    } else if (a.kind === 'rect') {
      page.drawRectangle({
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        borderColor: a.stroke ? hexRgb(a.stroke) : undefined,
        borderWidth: a.stroke ? a.strokeWidth : 0,
        color: a.fill ? hexRgb(a.fill) : undefined,
      })
    } else {
      page.drawEllipse({
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
        xScale: r.width / 2,
        yScale: r.height / 2,
        borderColor: a.stroke ? hexRgb(a.stroke) : undefined,
        borderWidth: a.stroke ? a.strokeWidth : 0,
        color: a.fill ? hexRgb(a.fill) : undefined,
      })
    }
  }

  return doc.save()
}
