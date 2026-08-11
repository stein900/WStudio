/**
 * Passerelle entre les fichiers tableur (xlsx, xls, csv — lus et écrits par
 * SheetJS) et le format de données de la grille x-data-spreadsheet.
 * Adapté de la démo officielle SheetJS, complété par : nombre réel de lignes
 * et colonnes (sans quoi les grands fichiers seraient tronqués à la taille de
 * la grille par défaut), largeurs de colonnes et hauteurs de lignes.
 * Limite connue de l'édition communautaire de SheetJS : les mises en forme
 * (couleurs, gras…) ne traversent pas l'import/export xlsx — les valeurs,
 * formules et fusions, si.
 */
import * as XLSX from 'xlsx'

export interface XsCell {
  text?: string
  merge?: [number, number]
  style?: number
}

export interface XsRow {
  cells: Record<number, XsCell>
  height?: number
}

export type XsRows = { len?: number } & Record<number, XsRow>
export type XsCols = { len?: number } & Record<number, { width?: number }>

export interface XsSheet {
  name: string
  rows: XsRows
  cols?: XsCols
  merges?: string[]
}

/** Nombre minimal de lignes/colonnes affichées dans la grille. */
export const MIN_ROWS = 200
export const MIN_COLS = 26

/**
 * Lit un fichier tableur. Les CSV sont décodés à part : UTF-8 s'ils sont
 * valides (avec ou sans BOM), sinon Windows-1252 — l'encodage des CSV
 * produits par Excel en français.
 */
export async function readWorkbookFile(file: File): Promise<XLSX.WorkBook> {
  const buf = await file.arrayBuffer()
  if (/\.csv$/i.test(file.name)) {
    const bytes = new Uint8Array(buf)
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      text = new TextDecoder('windows-1252').decode(bytes)
    }
    return XLSX.read(text.replace(/^\ufeff/, ''), { type: 'string' })
  }
  return XLSX.read(buf, { type: 'array' })
}

/** Classeur SheetJS → données x-data-spreadsheet (une entrée par feuille). */
export function workbookToSheets(wb: XLSX.WorkBook): XsSheet[] {
  const out: XsSheet[] = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    const sheet: XsSheet = { name, rows: {}, cols: {}, merges: [] }
    out.push(sheet)
    if (!ws || !ws['!ref']) {
      sheet.rows.len = MIN_ROWS
      sheet.cols!.len = MIN_COLS
      continue
    }

    // Partir de A1 : sheet_to_json ignore par défaut les lignes/colonnes
    // vides en tête, ce qui décalerait toutes les références.
    const range = XLSX.utils.decode_range(ws['!ref'])
    range.s = { r: 0, c: 0 }
    const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, {
      raw: false,
      header: 1,
      range,
    })

    aoa.forEach((r, i) => {
      const cells: Record<number, XsCell> = {}
      r.forEach((c, j) => {
        if (c == null) return
        cells[j] = { text: String(c) }
        const ref = XLSX.utils.encode_cell({ r: i, c: j })
        const f = ws[ref]?.f
        if (f != null) cells[j].text = `=${f}`
      })
      sheet.rows[i] = { cells }
    })

    for (const merge of ws['!merges'] ?? []) {
      // Les fusions dont la cellule maîtresse est vide doivent exister aussi
      sheet.rows[merge.s.r] ??= { cells: {} }
      sheet.rows[merge.s.r].cells[merge.s.c] ??= {}
      sheet.rows[merge.s.r].cells[merge.s.c].merge = [
        merge.e.r - merge.s.r,
        merge.e.c - merge.s.c,
      ]
      sheet.merges!.push(XLSX.utils.encode_range(merge))
    }

    ;(ws['!rows'] ?? []).forEach((r, i) => {
      const hpx = r?.hpx ?? (r?.hpt != null ? Math.round((r.hpt * 96) / 72) : undefined)
      if (hpx == null) return
      sheet.rows[i] ??= { cells: {} }
      sheet.rows[i].height = hpx
    })
    ;(ws['!cols'] ?? []).forEach((c, i) => {
      const wpx = c?.wpx ?? (c?.wch != null ? Math.round(c.wch * 7.5) : undefined)
      if (wpx != null) sheet.cols![i] = { width: wpx }
    })

    sheet.rows.len = Math.max(range.e.r + 1, MIN_ROWS)
    sheet.cols!.len = Math.max(range.e.c + 1, MIN_COLS)
  }
  return out
}

/** Données x-data-spreadsheet → classeur SheetJS (pour l'export). */
export function sheetsToWorkbook(sheets: XsSheet[]): XLSX.WorkBook {
  const out = XLSX.utils.book_new()
  const used = new Set<string>()
  sheets.forEach((sheet, idx) => {
    // Contraintes Excel : 31 caractères max, pas de []:*?/\ — et un doublon
    // écraserait la feuille précédente du classeur exporté.
    let name = (sheet.name || `Feuille${idx + 1}`).replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31)
    if (!name) name = `Feuille${idx + 1}`
    for (let i = 2; used.has(name); i++) name = `${name.slice(0, 27)} (${i})`
    used.add(name)
    out.SheetNames.push(name)
    out.Sheets[name] = sheetToWs(sheet)
  })
  return out
}

/** Une feuille x-data-spreadsheet → feuille SheetJS. */
export function sheetToWs(sheet: XsSheet): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {}
  const max = { r: 0, c: 0 }

  for (const rk of Object.keys(sheet.rows)) {
    const ri = Number(rk)
    if (!Number.isInteger(ri)) continue // clé « len »
    const row = sheet.rows[ri]
    for (const ck of Object.keys(row.cells ?? {})) {
      const ci = Number(ck)
      const cell = row.cells[ci]
      const text = cell.text ?? ''

      const ref = XLSX.utils.encode_cell({ r: ri, c: ci })
      let v: string | number | boolean = text
      let t: XLSX.CellObject['t'] = 's'
      if (!text) {
        t = 'z'
      } else if (text.trim() !== '' && !Number.isNaN(Number(text))) {
        v = Number(text)
        t = 'n'
      } else if (/^(true|false)$/i.test(text)) {
        v = /^true$/i.test(text)
        t = 'b'
      }
      ws[ref] = { v, t } as XLSX.CellObject
      if (t === 's' && text.startsWith('=')) (ws[ref] as XLSX.CellObject).f = text.slice(1)

      if (ri > max.r) max.r = ri
      if (ci > max.c) max.c = ci

      if (cell.merge) {
        const merges = (ws['!merges'] ??= [])
        merges.push({
          s: { r: ri, c: ci },
          e: { r: ri + cell.merge[0], c: ci + cell.merge[1] },
        })
        if (ri + cell.merge[0] > max.r) max.r = ri + cell.merge[0]
        if (ci + cell.merge[1] > max.c) max.c = ci + cell.merge[1]
      }
    }
    if (row.height != null) {
      const rows = (ws['!rows'] ??= [])
      rows[ri] = { hpx: row.height }
    }
  }

  for (const ck of Object.keys(sheet.cols ?? {})) {
    const ci = Number(ck)
    if (!Number.isInteger(ci)) continue
    const width = sheet.cols![ci]?.width
    if (width == null) continue
    const cols = (ws['!cols'] ??= [])
    cols[ci] = { wpx: width }
  }

  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: max })
  return ws
}

/** Une feuille contient-elle la moindre valeur ? */
export function sheetHasContent(sheet: XsSheet): boolean {
  for (const rk of Object.keys(sheet.rows)) {
    if (!Number.isInteger(Number(rk))) continue
    const cells = sheet.rows[Number(rk)].cells ?? {}
    for (const ck of Object.keys(cells)) {
      if ((cells[Number(ck)].text ?? '') !== '') return true
    }
  }
  return false
}
