import type { PageSettings } from '../types'

/** Projet tel que listé sur la page d'accueil. */
export interface ProjectInfo {
  name: string
  path: string
  title: string | null
  words: number
  updatedAt: number
  /** Début du document (markdown brut), rendu en vignette sur la carte. */
  excerpt?: string
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

/** Données d'un classeur tableur : une entrée par feuille (format x-data-spreadsheet). */
export type SheetWorkbook = unknown[]

/** Projet tableur tel que listé sur la page d'accueil. */
export interface SheetProjectInfo {
  name: string
  path: string
  /** Nombre de feuilles du classeur. */
  sheets: number
  /** Nombre de cellules remplies (toutes feuilles). */
  cells: number
  updatedAt: number
  /** Coin haut-gauche de la première feuille (lignes × colonnes), pour la vignette. */
  preview?: string[][]
}

/** Projet tableur chargé. */
export interface SheetProjectData {
  name: string
  path: string
  data: SheetWorkbook
  /** Projet jetable, stocké dans le dossier temp de Windows (jamais listé). */
  temporary?: boolean
}

/**
 * Fichier ouvert via « Ouvrir avec » de Windows (WStudio application par
 * défaut) : chemin + contenu, lu par le processus principal — le renderer
 * n'a pas accès au disque.
 */
export interface OpenWithFile {
  path: string
  name: string
  /** Buffer côté main, reçu en Uint8Array côté renderer. */
  bytes: Uint8Array
}

/** Famille d'API d'un profil de modèle IA. */
export type AiApi = 'anthropic' | 'openai'

/** Profil de modèle IA, vu du renderer (la clé reste dans le main). */
export interface AiProfile {
  id: string
  name: string
  api: AiApi
  baseUrl: string
  model: string
  hasKey: boolean
}

/** Configuration publique de l'assistant IA. */
export interface AiConfigInfo {
  profiles: AiProfile[]
  activeProfileId: string | null
}

/** Données envoyées pour créer (id absent) ou modifier un profil. */
export interface AiProfileDraft {
  id?: string
  name: string
  api: AiApi
  baseUrl: string
  model: string
  /** Absente ou vide = clé existante conservée. */
  apiKey?: string
}

/**
 * Modification proposée par l'agent : un passage existant cité mot pour mot
 * (l'ancre) et son remplacement. Le renderer localise l'ancre dans le
 * document ; une citation introuvable est rejetée — l'agent ne peut donc
 * toucher que ce qu'il a correctement cité.
 */
export interface AiEdit {
  original: string
  replacement: string
  reason: string
}

/** Requête IA envoyée au processus principal. */
export type AiRunRequest =
  | { requestId: string; kind: 'correct' | 'rewrite'; text: string }
  | { requestId: string; kind: 'custom'; text: string; instruction: string }
  | { requestId: string; kind: 'agent'; document: string; instruction: string }

/** Résultat d'une requête IA. */
export type AiRunResult =
  | { ok: true; text: string; edits?: undefined }
  | { ok: true; edits: AiEdit[]; text?: undefined }
  | { ok: false; error: string; canceled?: boolean }

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
  listSheetProjects(): Promise<SheetProjectInfo[]>
  createSheetProject(opts: {
    name: string
    data?: SheetWorkbook
    temporary?: boolean
  }): Promise<SheetProjectData>
  openSheetProject(dir: string): Promise<SheetProjectData | null>
  saveSheetProject(opts: { path: string; data: SheetWorkbook }): Promise<boolean>
  saveSheetProjectNow(opts: { path: string; data: SheetWorkbook }): void
  saveAsset(opts: { projectPath: string; dataUrl: string }): Promise<string | null>
  extractDataImages(opts: {
    path: string
    markdown: string
  }): Promise<{ markdown: string; count: number }>
  writePreviewFile(opts: { html: string; slot: 'A' | 'B' }): Promise<string>
  openWithConsume(): Promise<OpenWithFile | null>
  onOpenWith(callback: (file: OpenWithFile) => void): () => void
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
  aiGetConfig(): Promise<AiConfigInfo>
  aiSaveProfile(profile: AiProfileDraft): Promise<AiConfigInfo>
  aiDeleteProfile(id: string): Promise<AiConfigInfo>
  aiSetActiveProfile(id: string): Promise<AiConfigInfo>
  aiRun(req: AiRunRequest): Promise<AiRunResult>
  aiCancel(requestId: string): void
  onAiProgress(callback: (payload: { requestId: string; delta: string }) => void): () => void
  electronVersion: string
}

declare global {
  interface Window {
    rapportApp?: RapportBridge
  }
}

export const desktop: RapportBridge | undefined = window.rapportApp

export const isDesktop = Boolean(desktop)
