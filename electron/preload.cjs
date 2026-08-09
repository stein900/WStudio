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

  electronVersion: process.versions.electron,
})
