// Processus principal Electron de WStudio.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, protocol, net, nativeTheme } = require('electron')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { registerAiIpc } = require('./ai.cjs')

// Protocole interne servant les images des projets à l'éditeur (une page http
// en dev ne peut pas charger de file:// ; secure:true évite le contenu mixte).
protocol.registerSchemesAsPrivileged([
  { scheme: 'wstudio', privileges: { secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
])

// Racine des projets : Documents\WStudio\<Nom_du_projet>\
const projectsRoot = () => path.join(app.getPath('documents'), 'WStudio')
// Projets temporaires : dossier temp de Windows, nettoyé par le système —
// jamais listés sur l'accueil, rien ne reste dans les documents de l'utilisateur.
const tempRoot = () => path.join(app.getPath('temp'), 'WStudio Temporaire')
const PROJECT_MD = 'rapport.md'
const PROJECT_META = 'projet.json'

const DEV_URL = 'http://127.0.0.1:5173'
const isDev = !app.isPackaged

/** @type {BrowserWindow | null} */
let mainWindow = null

// ------------------------------------------------------------------
// Mémorisation de la géométrie de fenêtre entre les sessions
// ------------------------------------------------------------------
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json')

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
  } catch {
    return {}
  }
}

function saveWindowState(win) {
  try {
    if (win.isDestroyed()) return
    const state = { maximized: win.isMaximized(), ...(win.isMaximized() ? {} : win.getBounds()) }
    fs.writeFileSync(stateFile(), JSON.stringify(state))
  } catch {
    /* non bloquant */
  }
}

// ------------------------------------------------------------------
// Fenêtre principale
// ------------------------------------------------------------------
function createWindow() {
  const state = loadWindowState()
  mainWindow = new BrowserWindow({
    width: state.width ?? 1480,
    height: state.height ?? 920,
    x: state.x,
    y: state.y,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    // = --canvas clair/sombre (index.css) : évite l'éclair blanc au démarrage.
    // Approximation par le thème système — le choix mémorisé dans l'app prend
    // le relais dès le premier rendu.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7',
    title: 'WStudio',
    // .ico sur Windows : contient les tailles 16→256, la barre des tâches et la
    // barre de titre piochent la bonne au lieu de redimensionner le PNG.
    icon: path.join(
      __dirname,
      '..',
      'buildResources',
      process.platform === 'win32' ? 'icon.ico' : 'icon.png'
    ),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox désactivé : l'API de l'élément <webview> (événements
      // console-message, executeJavaScript) n'est pas injectée dans un
      // renderer sandboxé — or l'aperçu paginé en dépend.
      sandbox: false,
      spellcheck: true,
      // l'aperçu paginé tourne dans un <webview> (processus séparé : la
      // pagination d'un gros document ne gèle plus la frappe)
      webviewTag: true,
    },
  })

  if (state.maximized) mainWindow.maximize()
  mainWindow.once('ready-to-show', () => mainWindow.show())

  let saveTimer = null
  const queueSave = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => mainWindow && saveWindowState(mainWindow), 400)
  }
  mainWindow.on('resize', queueSave)
  mainWindow.on('move', queueSave)
  mainWindow.on('close', () => mainWindow && saveWindowState(mainWindow))
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Liens externes → navigateur par défaut, jamais dans l'application
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const allowed = isDev ? url.startsWith(DEV_URL) : url.startsWith('file:')
    if (!allowed) {
      e.preventDefault()
      if (/^https?:/i.test(url)) shell.openExternal(url)
    }
  })

  // RAPPORT_DIST=1 : charger la version construite sans empaqueter (tests)
  if (isDev && process.env.RAPPORT_DIST !== '1') {
    mainWindow.loadURL(DEV_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

// ------------------------------------------------------------------
// Menu applicatif (français)
// ------------------------------------------------------------------
const sendMenu = (action) => mainWindow?.webContents.send('menu', action)

function buildMenu() {
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    {
      label: '&Fichier',
      submenu: [
        { label: 'Nouveau projet…', accelerator: 'CmdOrCtrl+N', click: () => sendMenu('new') },
        {
          label: 'Accueil — tous les projets',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenu('home'),
        },
        { type: 'separator' },
        { label: 'Enregistrer maintenant', accelerator: 'CmdOrCtrl+S', click: () => sendMenu('save') },
        {
          label: "Ouvrir le dossier du projet",
          click: () => sendMenu('reveal'),
        },
        { type: 'separator' },
        {
          label: 'Exporter en PDF…',
          accelerator: 'CmdOrCtrl+E',
          click: () => sendMenu('export-pdf'),
        },
        { type: 'separator' },
        { label: 'Quitter', role: 'quit' },
      ],
    },
    {
      label: '&Édition',
      submenu: [
        { label: 'Annuler', role: 'undo' },
        { label: 'Rétablir', role: 'redo' },
        { type: 'separator' },
        { label: 'Couper', role: 'cut' },
        { label: 'Copier', role: 'copy' },
        { label: 'Coller', role: 'paste' },
        { label: 'Tout sélectionner', role: 'selectAll' },
      ],
    },
    {
      label: '&Affichage',
      submenu: [
        { label: 'Mode Markdown', accelerator: 'CmdOrCtrl+1', click: () => sendMenu('mode-markdown') },
        { label: 'Mode Document', accelerator: 'CmdOrCtrl+2', click: () => sendMenu('mode-doc') },
        { type: 'separator' },
        { label: 'Mise en page…', accelerator: 'CmdOrCtrl+,', click: () => sendMenu('settings') },
        { label: 'Assistant IA…', accelerator: 'CmdOrCtrl+Shift+A', click: () => sendMenu('ai') },
        { label: 'Prompt IA…', click: () => sendMenu('prompt') },
        { type: 'separator' },
        { label: 'Zoom avant', role: 'zoomIn' },
        { label: 'Zoom arrière', role: 'zoomOut' },
        { label: 'Taille réelle', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Plein écran', role: 'togglefullscreen' },
        ...(isDev
          ? [{ type: 'separator' }, { label: 'Outils de développement', role: 'toggleDevTools' }]
          : []),
      ],
    },
    {
      label: '&Aide',
      submenu: [
        {
          label: 'À propos de WStudio',
          click: () =>
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'À propos',
              message: 'WStudio',
              detail: `Version ${app.getVersion()}\n\nMarkdown (avec Mermaid) vers PDF professionnel.\nProjets enregistrés automatiquement dans Documents\\WStudio.`,
              buttons: ['Fermer'],
            }),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ------------------------------------------------------------------
// IPC : projets (Documents\WStudio\<Nom>\ — rapport.md + projet.json)
// ------------------------------------------------------------------
function sanitizeProjectName(name) {
  const clean = name
    .replace(/[<>:"/\\|?*]/g, ' ') // caractères interdits dans un nom de dossier Windows
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  return clean.slice(0, 80) || 'Projet sans nom'
}

async function readProject(dir) {
  const markdown = await fs.promises.readFile(path.join(dir, PROJECT_MD), 'utf8')
  let settings = null
  try {
    settings = JSON.parse(await fs.promises.readFile(path.join(dir, PROJECT_META), 'utf8')).settings ?? null
  } catch {
    /* métadonnées absentes ou corrompues : réglages par défaut */
  }
  return { name: path.basename(dir), path: dir, markdown, settings }
}

async function writeProject(dir, markdown, settings) {
  await fs.promises.mkdir(dir, { recursive: true })
  await fs.promises.writeFile(path.join(dir, PROJECT_MD), markdown, 'utf8')
  await fs.promises.writeFile(
    path.join(dir, PROJECT_META),
    JSON.stringify({ settings, updatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  )
}

ipcMain.handle('projects:list', async () => {
  const root = projectsRoot()
  await fs.promises.mkdir(root, { recursive: true })
  const entries = await fs.promises.readdir(root, { withFileTypes: true })
  const projects = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const dir = path.join(root, e.name)
    try {
      const mdPath = path.join(dir, PROJECT_MD)
      const stat = await fs.promises.stat(mdPath)
      const content = await fs.promises.readFile(mdPath, 'utf8')
      const m = content.match(/^#\s+(.+)$/m)
      projects.push({
        name: e.name,
        path: dir,
        title: m ? m[1].replace(/[*_`#]/g, '').trim() : null,
        words: content.trim() ? content.trim().split(/\s+/).length : 0,
        updatedAt: stat.mtimeMs,
      })
    } catch {
      /* dossier sans rapport.md : ignoré */
    }
  }
  projects.sort((a, b) => b.updatedAt - a.updatedAt)
  return projects
})

ipcMain.handle('projects:create', async (_e, { name, markdown, temporary }) => {
  const root = temporary ? tempRoot() : projectsRoot()
  const base = sanitizeProjectName(name)
  let dir = path.join(root, base)
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(root, `${base} (${i})`)
  const content = markdown ?? `# ${base}\n\n[TOC]\n\n## 1. Introduction\n\n`
  await writeProject(dir, content, null)
  return {
    name: path.basename(dir),
    path: dir,
    markdown: content,
    settings: null,
    temporary: Boolean(temporary),
  }
})

ipcMain.handle('projects:open', async (_e, dir) => {
  try {
    return await readProject(dir)
  } catch (err) {
    dialog.showErrorBox('Ouverture du projet', `Impossible d'ouvrir le projet : ${err.message}`)
    return null
  }
})

const saveProject = async (_e, { path: dir, markdown, settings }) => {
  await writeProject(dir, markdown, settings)
  return true
}
ipcMain.handle('projects:save', saveProject)
// variante « lâcher-prise » utilisée à la fermeture de la fenêtre
ipcMain.on('projects:save-now', (e, opts) => {
  saveProject(e, opts).catch(() => {})
})

ipcMain.handle('projects:reveal', (_e, dir) => {
  shell.openPath(dir)
})

ipcMain.handle('projects:delete', async (_e, dir) => {
  // garde-fou : ne supprimer que sous la racine WStudio
  const root = projectsRoot()
  if (!path.resolve(dir).startsWith(root + path.sep)) return false
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Supprimer le projet',
    message: `Supprimer définitivement « ${path.basename(dir)} » ?`,
    detail: 'Le dossier du projet et tout son contenu seront placés dans la corbeille.',
    buttons: ['Annuler', 'Supprimer'],
    defaultId: 0,
    cancelId: 0,
  })
  if (response !== 1) return false
  await shell.trashItem(path.resolve(dir))
  return true
})

// ------------------------------------------------------------------
// Images de projet : fichiers dans <projet>\assets\, nom stable par
// empreinte du contenu (collages répétés → même fichier, zéro doublon).
// ------------------------------------------------------------------
const IMAGE_EXT = { jpeg: 'jpg', 'svg+xml': 'svg', 'x-icon': 'ico' }

async function writeAsset(projectPath, buffer, extRaw) {
  const ext = IMAGE_EXT[extRaw] || extRaw
  const dir = path.join(projectPath, 'assets')
  await fs.promises.mkdir(dir, { recursive: true })
  const hash = crypto.createHash('md5').update(buffer).digest('hex').slice(0, 10)
  const name = `img-${hash}.${ext}`
  const file = path.join(dir, name)
  if (!fs.existsSync(file)) await fs.promises.writeFile(file, buffer)
  return `assets/${name}`
}

ipcMain.handle('assets:save', async (_e, { projectPath, dataUrl }) => {
  const m = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/is.exec(dataUrl)
  if (!m) return null
  return writeAsset(projectPath, Buffer.from(m[2], 'base64'), m[1].toLowerCase())
})

// Remplace toutes les images base64 d'un markdown par des fichiers assets/.
ipcMain.handle('assets:extract', async (_e, { path: projectPath, markdown }) => {
  const re = /data:image\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/gi
  const seen = new Map()
  let count = 0
  let result = markdown
  for (const m of markdown.matchAll(re)) {
    if (seen.has(m[0])) continue
    try {
      const rel = await writeAsset(projectPath, Buffer.from(m[2], 'base64'), m[1].toLowerCase())
      seen.set(m[0], rel)
      count++
    } catch {
      /* image illisible : laissée telle quelle */
    }
  }
  for (const [uri, rel] of seen) result = result.split(uri).join(rel)
  return { markdown: result, count }
})

// ------------------------------------------------------------------
// IPC : aperçu paginé — le HTML est servi au <webview> via un fichier
// temporaire (double tampon A/B, un fichier par face).
// ------------------------------------------------------------------
ipcMain.handle('preview:write', async (_e, { html, slot }) => {
  const file = path.join(app.getPath('temp'), `wstudio-preview-${slot === 'B' ? 'B' : 'A'}.html`)
  await fs.promises.writeFile(file, html, 'utf8')
  return require('url').pathToFileURL(file).toString()
})

// ------------------------------------------------------------------
// IPC : fichiers Markdown
// ------------------------------------------------------------------
ipcMain.handle('md:open', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Ouvrir un document Markdown',
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
      { name: 'Tous les fichiers', extensions: ['*'] },
    ],
    properties: ['openFile'],
  })
  if (canceled || filePaths.length === 0) return null
  const filePath = filePaths[0]
  const content = await fs.promises.readFile(filePath, 'utf8')
  return { path: filePath, content }
})

ipcMain.handle('md:save', async (_e, { path: knownPath, content, suggestedName, forceDialog }) => {
  let filePath = knownPath
  if (!filePath || forceDialog) {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Enregistrer le document',
      defaultPath: knownPath ?? suggestedName,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (res.canceled || !res.filePath) return null
    filePath = res.filePath
  }
  await fs.promises.writeFile(filePath, content, 'utf8')
  return { path: filePath }
})

// ------------------------------------------------------------------
// IPC : export PDF natif — le HTML autonome (déjà paginé par Paged.js à
// l'ouverture) est chargé dans une fenêtre cachée, puis converti en PDF
// par le moteur d'impression de Chromium et écrit directement sur disque.
// ------------------------------------------------------------------
ipcMain.handle('pdf:export', async (_e, { html, suggestedName }) => {
  // RAPPORT_TEST_PDF : chemin imposé (tests automatisés, pas de dialogue)
  let filePath = process.env.RAPPORT_TEST_PDF || null
  if (!filePath) {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Exporter en PDF',
      defaultPath: suggestedName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (res.canceled || !res.filePath) return null
    filePath = res.filePath
  }

  const tmp = path.join(app.getPath('temp'), `rapportcreator-export-${Date.now()}.html`)
  await fs.promises.writeFile(tmp, html, 'utf8')

  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true },
  })
  try {
    await win.loadFile(tmp)
    // Attendre la fin de la pagination (window.__pagedDone posé par PagedConfig.after)
    const deadline = Date.now() + 120_000
    let pages = 0
    for (;;) {
      pages = await win.webContents.executeJavaScript('window.__pagedDone || 0', true)
      if (pages) break
      if (Date.now() > deadline) throw new Error('Délai de pagination dépassé')
      await new Promise((r) => setTimeout(r, 250))
    }
    const pdf = await win.webContents.printToPDF({
      preferCSSPageSize: true,
      printBackground: true,
    })
    await fs.promises.writeFile(filePath, pdf)
    if (!process.env.RAPPORT_TEST_PDF) shell.showItemInFolder(filePath)
    return { path: filePath, pages }
  } catch (err) {
    dialog.showErrorBox('Export PDF', `L'export a échoué : ${err.message}`)
    return null
  } finally {
    win.destroy()
    fs.promises.unlink(tmp).catch(() => {})
  }
})

// ------------------------------------------------------------------
// IPC : export PDF depuis l'aperçu LUI-MÊME (webview de l'aperçu paginé).
// Même DOM déjà paginé → coupures du PDF identiques à l'aperçu, par
// construction (l'habillage écran est neutralisé par @media print).
// ------------------------------------------------------------------
ipcMain.handle('pdf:export-wc', async (_e, { webContentsId, suggestedName }) => {
  const { webContents } = require('electron')
  const wc = webContents.fromId(webContentsId)
  if (!wc || wc.isDestroyed()) return null

  let filePath = process.env.RAPPORT_TEST_PDF || null
  if (!filePath) {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Exporter en PDF',
      defaultPath: suggestedName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (res.canceled || !res.filePath) return null
    filePath = res.filePath
  }
  try {
    const pdf = await wc.printToPDF({ preferCSSPageSize: true, printBackground: true })
    await fs.promises.writeFile(filePath, pdf)
    if (!process.env.RAPPORT_TEST_PDF) shell.showItemInFolder(filePath)
    return { path: filePath }
  } catch (err) {
    dialog.showErrorBox('Export PDF', `L'export a échoué : ${err.message}`)
    return null
  }
})

// ------------------------------------------------------------------
// Cycle de vie
// ------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('io.github.stein900.wstudio')

    // wstudio://asset/<chemin absolu encodé> → fichier, restreint à la racine
    // des projets (aucun autre fichier du disque n'est accessible).
    protocol.handle('wstudio', (request) => {
      try {
        const enc = request.url.replace(/^wstudio:\/\/asset\//i, '').replace(/[?#].*$/, '')
        const abs = path.resolve(decodeURIComponent(enc))
        const roots = [projectsRoot(), tempRoot()].map(
          (r) => path.resolve(r).toLowerCase() + path.sep
        )
        if (!roots.some((r) => abs.toLowerCase().startsWith(r)))
          return new Response('Interdit', { status: 403 })
        return net.fetch(pathToFileURL(abs).toString())
      } catch {
        return new Response('Requête invalide', { status: 400 })
      }
    })

    registerAiIpc()
    buildMenu()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
