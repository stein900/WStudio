export interface PageSettings {
  headerText: string
  headerLogo: string | null // data URL
  footerText: string
  pageNumbers: boolean
  headerOnFirstPage: boolean
  h1NewPage: boolean
  autoToc: boolean
  fontFamily: 'sans' | 'serif'
  fontSize: number // pt, corps du texte
}

export const DEFAULT_SETTINGS: PageSettings = {
  headerText: '',
  headerLogo: null,
  footerText: '',
  pageNumbers: true,
  headerOnFirstPage: false,
  h1NewPage: true,
  autoToc: false,
  fontFamily: 'sans',
  fontSize: 11,
}

export type EditorMode = 'markdown' | 'doc'
