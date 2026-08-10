export type HfAlign = 'left' | 'center' | 'right'

export interface PageSettings {
  headerText: string
  /** Alignement du texte d'en-tête dans la bande. */
  headerTextAlign: HfAlign
  /** Taille du texte d'en-tête (pt). */
  headerTextSize: number
  /** Décalage vertical du texte d'en-tête (mm, négatif = vers le haut). */
  headerTextOffsetY: number
  headerLogo: string | null // data URL
  /** Position du logo dans la bande d'en-tête. */
  headerLogoAlign: HfAlign
  /** Hauteur du logo (mm). */
  headerLogoSize: number
  /** Décalage vertical du logo (mm, négatif = vers le haut). */
  headerLogoOffsetY: number
  footerText: string
  footerTextAlign: HfAlign
  footerTextSize: number
  /** Décalage vertical du texte de pied (mm, négatif = vers le haut). */
  footerTextOffsetY: number
  pageNumbers: boolean
  headerOnFirstPage: boolean
  h1NewPage: boolean
  autoToc: boolean
  fontFamily: 'sans' | 'serif'
  fontSize: number // pt, corps du texte
}

export const DEFAULT_SETTINGS: PageSettings = {
  headerText: '',
  headerTextAlign: 'right',
  headerTextSize: 9,
  headerTextOffsetY: 0,
  headerLogo: null,
  headerLogoAlign: 'left',
  headerLogoSize: 9,
  headerLogoOffsetY: 0,
  footerText: '',
  footerTextAlign: 'left',
  footerTextSize: 9,
  footerTextOffsetY: 0,
  pageNumbers: true,
  headerOnFirstPage: false,
  h1NewPage: true,
  autoToc: false,
  fontFamily: 'sans',
  fontSize: 11,
}

export type EditorMode = 'markdown' | 'doc'
