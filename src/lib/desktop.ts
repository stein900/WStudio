import type { PageSettings } from '../types'

/** Projet tel que listé sur la page d'accueil. */
export interface ProjectInfo {
  name: string
  path: string
  title: string | null
  words: number
  updatedAt: number
}

/** Projet chargé (contenu + réglages). */
export interface ProjectData {
  name: string
  path: string
  markdown: string
  settings: PageSettings | null
  /** Projet jetable, stocké dans le dossier temp de Windows (jamais listé). */
  temporary?: boolean
}

/** Pont exposé par le preload Electron (absent dans un navigateur). */
export interface RapportBridge {
  listProjects(): Promise<ProjectInfo[]>
  createProject(opts: {
    name: string
    markdown?: string
    temporary?: boolean
  }): Promise<ProjectData>
  openProject(dir: string): Promise<ProjectData | null>
  saveProject(opts: { path: string; markdown: string; settings: PageSettings }): Promise<boolean>
  saveProjectNow(opts: { path: string; markdown: string; settings: PageSettings }): void
  revealProject(dir: string): Promise<void>
  deleteProject(dir: string): Promise<boolean>
  saveAsset(opts: { projectPath: string; dataUrl: string }): Promise<string | null>
  extractDataImages(opts: {
    path: string
    markdown: string
  }): Promise<{ markdown: string; count: number }>
  writePreviewFile(opts: { html: string; slot: 'A' | 'B' }): Promise<string>
  openMarkdown(): Promise<{ path: string; content: string } | null>
  saveMarkdown(opts: {
    path: string | null
    content: string
    suggestedName: string
    forceDialog?: boolean
  }): Promise<{ path: string } | null>
  exportPdf(opts: {
    html: string
    suggestedName: string
  }): Promise<{ path: string; pages: number } | null>
  exportPdfFromWebContents(opts: {
    webContentsId: number
    suggestedName: string
  }): Promise<{ path: string } | null>
  onMenu(callback: (action: string) => void): () => void
  electronVersion: string
}

declare global {
  interface Window {
    rapportApp?: RapportBridge
  }
}

export const desktop: RapportBridge | undefined = window.rapportApp

export const isDesktop = Boolean(desktop)
