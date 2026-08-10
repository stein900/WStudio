// Pont sécurisé entre le renderer et le processus principal.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('rapportApp', {
  // --- Projets (Documents\WStudio\<Nom>\) ---
  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (opts) => ipcRenderer.invoke('projects:create', opts),
  openProject: (dir) => ipcRenderer.invoke('projects:open', dir),
  saveProject: (opts) => ipcRenderer.invoke('projects:save', opts),
  /** Sauvegarde « fire-and-forget » utilisée à la fermeture de la fenêtre. */
  saveProjectNow: (opts) => ipcRenderer.send('projects:save-now', opts),
  revealProject: (dir) => ipcRenderer.invoke('projects:reveal', dir),
  deleteProject: (dir) => ipcRenderer.invoke('projects:delete', dir),

  /** Enregistre une image (data URL) dans <projet>\assets\, renvoie son chemin relatif. */
  saveAsset: (opts) => ipcRenderer.invoke('assets:save', opts),

  /** Remplace toutes les images base64 d'un markdown par des fichiers assets/. */
  extractDataImages: (opts) => ipcRenderer.invoke('assets:extract', opts),

  /** Écrit le HTML d'aperçu dans un fichier temporaire, renvoie son URL file://. */
  writePreviewFile: (opts) => ipcRenderer.invoke('preview:write', opts),

  /** Boîte de dialogue native d'ouverture ; null si annulée. */
  openMarkdown: () => ipcRenderer.invoke('md:open'),

  /**
   * Enregistre le Markdown. Sans chemin connu (ou avec forceDialog), ouvre
   * la boîte « Enregistrer sous ». Retourne { path } ou null si annulé.
   */
  saveMarkdown: (opts) => ipcRenderer.invoke('md:save', opts),

  /**
   * Exporte le HTML paginé en fichier PDF (boîte de dialogue native puis
   * écriture directe). Retourne { path, pages } ou null si annulé.
   */
  exportPdf: (opts) => ipcRenderer.invoke('pdf:export', opts),

  /** Exporte en PDF le webview de l'aperçu lui-même (fidélité garantie). */
  exportPdfFromWebContents: (opts) => ipcRenderer.invoke('pdf:export-wc', opts),

  /** Abonne le renderer aux actions du menu applicatif. */
  onMenu: (callback) => {
    const listener = (_event, action) => callback(action)
    ipcRenderer.on('menu', listener)
    return () => ipcRenderer.removeListener('menu', listener)
  },

  // --- Assistant IA (les clés API restent dans le processus principal) ---
  /** Configuration publique de l'IA : { profiles, activeProfileId }. */
  aiGetConfig: () => ipcRenderer.invoke('ai:get-config'),
  /** Crée ou met à jour un profil de modèle (clé chiffrée via safeStorage). */
  aiSaveProfile: (profile) => ipcRenderer.invoke('ai:save-profile', profile),
  /** Supprime un profil de modèle. */
  aiDeleteProfile: (id) => ipcRenderer.invoke('ai:delete-profile', id),
  /** Sélectionne le profil actif. */
  aiSetActiveProfile: (id) => ipcRenderer.invoke('ai:set-active-profile', id),
  /** Lance une requête IA (correction, reformulation, agent…). */
  aiRun: (req) => ipcRenderer.invoke('ai:run', req),
  /** Annule la requête IA en cours identifiée par requestId. */
  aiCancel: (requestId) => ipcRenderer.send('ai:cancel', requestId),
  /** Abonne le renderer au flux de progression des requêtes IA. */
  onAiProgress: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('ai:progress', listener)
    return () => ipcRenderer.removeListener('ai:progress', listener)
  },

  electronVersion: process.versions.electron,
})
