// Module IA de WStudio : profils de modèles (fournisseur, URL, clé, modèle)
// et appels aux API depuis le processus principal. Les clés API sont chiffrées
// via safeStorage et ne transitent jamais vers le renderer — celui-ci ne voit
// que des profils « publics » ({ id, name, api, baseUrl, model, hasKey }).
//
// Deux familles d'API sont prises en charge :
//   - 'anthropic' : API Messages d'Anthropic (SDK officiel @anthropic-ai/sdk)
//   - 'openai'    : toute API « chat completions » compatible OpenAI
//                   (OpenAI, OpenRouter, Groq, Mistral, Ollama…, SDK openai)
const { app, ipcMain, safeStorage } = require('electron')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const anthropicSdk = require('@anthropic-ai/sdk')
const Anthropic = anthropicSdk.Anthropic ?? anthropicSdk.default ?? anthropicSdk
const openaiSdk = require('openai')
const OpenAI = openaiSdk.OpenAI ?? openaiSdk.default ?? openaiSdk

const configFile = () => path.join(app.getPath('userData'), 'ai-config.json')

// ------------------------------------------------------------------
// Configuration : { profiles: [{ id, name, api, baseUrl, model, key }],
//                   activeProfileId }
// key = { enc: base64 } (safeStorage) ou { plain: string } (repli).
// ------------------------------------------------------------------
function loadConfig() {
  let config
  try {
    config = JSON.parse(fs.readFileSync(configFile(), 'utf8'))
  } catch {
    config = {}
  }
  if (!Array.isArray(config.profiles)) config.profiles = []

  // Migration depuis l'ancien format mono-modèle { model, key }
  if (config.key && config.profiles.length === 0) {
    config.profiles.push({
      id: crypto.randomUUID(),
      name: 'Claude',
      api: 'anthropic',
      baseUrl: '',
      model: config.model || 'claude-opus-5',
      key: config.key,
    })
    config.activeProfileId = config.profiles[0].id
    delete config.key
    delete config.model
    saveConfig(config)
  }
  return config
}

function saveConfig(config) {
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2), 'utf8')
}

function encryptKey(apiKey) {
  if (safeStorage.isEncryptionAvailable())
    return { enc: safeStorage.encryptString(apiKey).toString('base64') }
  return { plain: apiKey }
}

function readApiKey(profile) {
  const key = profile?.key
  if (!key) return null
  try {
    if (key.enc) return safeStorage.decryptString(Buffer.from(key.enc, 'base64'))
    if (key.plain) return key.plain
  } catch {
    /* clé illisible (profil Windows changé…) : considérée absente */
  }
  return null
}

function publicProfile(p) {
  return {
    id: p.id,
    name: p.name,
    api: p.api,
    baseUrl: p.baseUrl || '',
    model: p.model,
    hasKey: Boolean(readApiKey(p)),
  }
}

function publicConfig(config) {
  const profiles = config.profiles.map(publicProfile)
  const activeProfileId = profiles.some((p) => p.id === config.activeProfileId)
    ? config.activeProfileId
    : (profiles[0]?.id ?? null)
  return { profiles, activeProfileId }
}

// ------------------------------------------------------------------
// Prompts système (le document est du Markdown destiné à un PDF pro)
// ------------------------------------------------------------------
const CONTEXT =
  "Le texte fait partie d'un rapport professionnel rédigé en Markdown dans WStudio, " +
  'converti tel quel en PDF. La mise en forme Markdown (titres, listes, tableaux, ' +
  'code, mathématiques LaTeX, blocs mermaid, liens, images) doit être strictement préservée.'

const SYSTEM_CORRECT =
  `Tu es un correcteur professionnel francophone. ${CONTEXT}\n` +
  "On te fournit un extrait : corrige uniquement l'orthographe, la grammaire, la " +
  'ponctuation et la typographie française (espaces insécables, guillemets « », ' +
  'apostrophes typographiques). Ne reformule pas, ne change ni le sens, ni le ton, ' +
  'ni la structure. Ne touche jamais au contenu des blocs de code, des formules et des URL.\n' +
  "Réponds UNIQUEMENT avec le texte corrigé, sans commentaire, sans l'entourer de bloc de code."

const SYSTEM_REWRITE =
  `Tu es un rédacteur technique senior francophone. ${CONTEXT}\n` +
  'On te fournit un extrait : reformule-le dans un registre professionnel soutenu ' +
  '(voix active, phrases claires, une idée par phrase, aucun émoji, aucun superlatif ' +
  'marketing), en conservant fidèlement le sens, les informations et la structure ' +
  'Markdown. Corrige au passage orthographe et typographie française.\n' +
  "Réponds UNIQUEMENT avec le texte reformulé, sans commentaire, sans l'entourer de bloc de code."

const SYSTEM_CUSTOM =
  `Tu es un assistant de rédaction professionnel francophone. ${CONTEXT}\n` +
  "On te fournit un extrait et une consigne : applique la consigne à l'extrait en " +
  'préservant la mise en forme Markdown et la typographie française.\n' +
  "Réponds UNIQUEMENT avec le texte résultant, sans commentaire, sans l'entourer de bloc de code."

const SYSTEM_AGENT =
  `Tu es un agent de rédaction et d'édition documentaire. ${CONTEXT}\n` +
  "On te fournit le document complet et une consigne. Lis tout le document pour en " +
  "comprendre le contexte, localise le ou les endroits concernés par la consigne, et " +
  'interviens UNIQUEMENT à ces endroits.\n' +
  'Chaque modification est un couple original → replacement :\n' +
  '- original est un passage du document recopié MOT POUR MOT, caractère pour caractère ' +
  '(lignes complètes et contiguës). Il sert à localiser la modification : une citation ' +
  "inexacte sera rejetée. Cite le passage le plus court qui reste unique dans le document " +
  "(quelques lignes suffisent ; ajoute une ligne de contexte si le passage apparaît plusieurs fois).\n" +
  '- replacement est le texte qui remplace exactement ce passage cité. Vide = suppression du passage.\n' +
  '- Pour INSÉRER du contenu sans rien perdre : cite une ligne existante voisine (un titre, ' +
  'la dernière ligne du document…) et donne en replacement cette même ligne recopiée à ' +
  "l'identique, suivie du nouveau contenu.\n" +
  '- Document vide ou quasi vide : original vide et tout le contenu rédigé dans replacement.\n' +
  'Règle absolue : tout ce qui n\'est pas cité dans un original reste intact. Il est donc ' +
  'INTERDIT de « réécrire le document » : n\'inclus jamais dans original des passages que ' +
  'tu ne modifies pas (à l\'exception d\'une ligne d\'ancrage pour une insertion), et ne ' +
  'supprime jamais du contenu existant que la consigne ne demande pas de supprimer.\n' +
  'Nature de la consigne :\n' +
  '- ÉDITION (corriger, harmoniser, reformuler, supprimer…) : plusieurs petites ' +
  'modifications ciblées, chacune limitée au strict nécessaire.\n' +
  '- RÉDACTION (rédiger, ajouter, développer, compléter…) : produis INTÉGRALEMENT le ' +
  'contenu demandé, aussi long que nécessaire, inséré au bon endroit via une ligne ' +
  "d'ancrage — sans toucher au reste. Une consigne de rédaction satisfaite par une seule " +
  'ligne est presque toujours un échec.\n' +
  'Les modifications sont données dans l\'ordre du document et ne se chevauchent pas. ' +
  'reason décrit chaque modification en une phrase courte en français. Si la consigne est ' +
  "déjà pleinement satisfaite, renvoie une liste d'edits vide."

// Format de sortie pour les API sans sorties structurées natives (chemin
// OpenAI) : des blocs rechercher/remplacer délimités par des marqueurs de
// conflit — robustes pour du texte multiligne et familiers des modèles.
const AGENT_BLOCK_INSTRUCTION =
  '\nFORMAT DE RÉPONSE OBLIGATOIRE — réponds uniquement avec une suite de blocs, ' +
  'sans aucun autre texte ni bloc de code Markdown :\n' +
  'EDIT | raison courte\n' +
  '<<<<<<< ORIGINAL\n' +
  'passage existant recopié mot pour mot (vide seulement si le document est vide)\n' +
  '=======\n' +
  'texte qui remplace ce passage (vide pour supprimer)\n' +
  '>>>>>>> FIN\n' +
  'Exemple 1 — correction ciblée :\n' +
  'EDIT | Correction d’un accord\n' +
  '<<<<<<< ORIGINAL\n' +
  'Les résultats obtenus sont coherent.\n' +
  '=======\n' +
  'Les résultats obtenus sont cohérents.\n' +
  '>>>>>>> FIN\n' +
  'Exemple 2 — insertion d’une section rédigée après un titre existant (titre recopié ' +
  'à l’identique, puis le nouveau contenu, aussi long que nécessaire) :\n' +
  'EDIT | Ajout de la section demandée\n' +
  '<<<<<<< ORIGINAL\n' +
  '## 2. Méthodologie\n' +
  '=======\n' +
  '## 2. Méthodologie\n' +
  '\n' +
  'La collecte des données repose sur trois campagnes de mesure…\n' +
  '>>>>>>> FIN\n' +
  "S'il n'y a rien à modifier, réponds exactement : AUCUNE MODIFICATION"

const AGENT_SCHEMA = {
  type: 'object',
  properties: {
    edits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          original: { type: 'string' },
          replacement: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['original', 'replacement', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['edits'],
  additionalProperties: false,
}

function buildRequest(req) {
  switch (req.kind) {
    case 'correct':
      return { system: SYSTEM_CORRECT, user: req.text }
    case 'rewrite':
      return { system: SYSTEM_REWRITE, user: req.text }
    case 'custom':
      return {
        system: SYSTEM_CUSTOM,
        user: `Consigne : ${req.instruction}\n\nExtrait :\n${req.text}`,
      }
    case 'agent':
      return {
        system: SYSTEM_AGENT,
        user: `Consigne : ${req.instruction}\n\nDocument :\n${req.document}`,
        agent: true,
      }
    default:
      throw new Error(`Type de requête inconnu : ${req.kind}`)
  }
}

/** Isole le JSON probable d'une réponse (bloc de code, texte parasite…). */
function extractJson(text) {
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) t = t.slice(start, end + 1)
  return t
}

/**
 * Répare le défaut JSON le plus fréquent chez les modèles : des sauts de
 * ligne bruts (non échappés) à l'intérieur des chaînes.
 */
function repairJsonNewlines(t) {
  let out = ''
  let inString = false
  let escaped = false
  for (const ch of t) {
    if (!inString) {
      if (ch === '"') inString = true
      out += ch
      continue
    }
    if (escaped) {
      escaped = false
      out += ch
    } else if (ch === '\\') {
      escaped = true
      out += ch
    } else if (ch === '"') {
      inString = false
      out += ch
    } else if (ch === '\n') {
      out += '\\n'
    } else if (ch === '\r') {
      /* ignoré */
    } else if (ch === '\t') {
      out += '\\t'
    } else {
      out += ch
    }
  }
  return out
}

/** Retire un unique saut de ligne final (contenu des groupes de capture). */
function stripLastNewline(s) {
  return s.replace(/\r?\n$/, '')
}

/** Analyse les blocs rechercher/remplacer « EDIT / <<<<<<< … ======= … >>>>>>> ». */
function parseAgentBlocks(text) {
  const edits = []
  const re = /^[ \t]*EDIT[ \t]*(?:\|[ \t]*([^\n]*))?\r?\n<{4,}[^\n]*\r?\n([\s\S]*?)^={4,}[^\n]*\r?\n([\s\S]*?)^>{4,}[^\n]*$/gm
  for (const m of text.matchAll(re)) {
    edits.push({
      original: stripLastNewline(m[2]),
      replacement: stripLastNewline(m[3]),
      reason: (m[1] || '').trim(),
    })
  }
  return edits
}

/**
 * Analyse tolérante de la réponse de l'agent, dans l'ordre :
 * JSON strict → blocs EDIT → JSON réparé → « AUCUNE MODIFICATION ».
 * Renvoie la liste d'edits ou null si la réponse est inexploitable.
 */
function parseAgentEdits(text) {
  const json = extractJson(text)
  try {
    const edits = JSON.parse(json).edits
    if (Array.isArray(edits)) return edits
  } catch {
    /* tentative suivante */
  }
  const blocks = parseAgentBlocks(text)
  if (blocks.length > 0) return blocks
  try {
    const edits = JSON.parse(repairJsonNewlines(json)).edits
    if (Array.isArray(edits)) return edits
  } catch {
    /* tentative suivante */
  }
  if (/AUCUNE\s+MODIFICATION/i.test(text)) return []
  return null
}

/** Message d'erreur lisible, commun aux deux SDK (statuts HTTP identiques). */
function friendlyError(err, aborted) {
  if (aborted || err?.name === 'APIUserAbortError' || err?.name === 'AbortError')
    return { ok: false, error: 'Annulé.', canceled: true }
  const status = err?.status
  if (status === 401 || status === 403)
    return { ok: false, error: 'Clé API invalide ou non autorisée. Vérifiez le profil dans les paramètres IA.' }
  if (status === 404)
    return { ok: false, error: 'Modèle ou URL introuvable. Vérifiez l’identifiant du modèle et l’URL de base du profil.' }
  if (status === 429)
    return { ok: false, error: 'Limite de débit ou crédit épuisé chez le fournisseur. Réessayez dans un instant.' }
  if (typeof status === 'number')
    return { ok: false, error: `Erreur de l’API (${status}) : ${err.message}` }
  if (err?.name === 'APIConnectionError' || err?.code === 'ENOTFOUND' || err?.code === 'ECONNREFUSED')
    return { ok: false, error: 'Connexion au fournisseur impossible. Vérifiez l’URL de base et votre accès internet.' }
  return { ok: false, error: err?.message || 'Erreur inattendue.' }
}

// ------------------------------------------------------------------
// Exécution — API Anthropic (Messages)
// ------------------------------------------------------------------
async function runAnthropic({ profile, apiKey, request, onDelta, register }) {
  const client = new Anthropic({ apiKey, baseURL: profile.baseUrl || undefined })
  const params = {
    model: profile.model,
    max_tokens: 64000,
    system: request.system,
    messages: [{ role: 'user', content: request.user }],
  }
  // Sorties structurées : la réponse de l'agent est un JSON validé
  if (request.agent)
    params.output_config = { format: { type: 'json_schema', schema: AGENT_SCHEMA } }
  // Repli serveur sur Claude Opus 5 (API Anthropic uniquement) : une requête
  // déclinée par les classificateurs est rejouée sur le modèle recommandé.
  const useFallback = profile.model === 'claude-opus-5' && !profile.baseUrl
  if (useFallback) {
    params.fallbacks = 'default'
    params.betas = ['server-side-fallback-2026-07-01']
  }

  const stream = useFallback ? client.beta.messages.stream(params) : client.messages.stream(params)
  register({ abort: () => stream.abort() })
  stream.on('text', onDelta)
  const message = await stream.finalMessage()

  if (message.stop_reason === 'refusal')
    return { ok: false, error: 'La requête a été déclinée par les garde-fous du modèle.' }
  if (message.stop_reason === 'max_tokens')
    return { ok: false, error: 'Réponse tronquée (document trop volumineux pour une seule passe).' }

  const text = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
  return { ok: true, text }
}

// ------------------------------------------------------------------
// Exécution — API compatible OpenAI (chat completions)
// ------------------------------------------------------------------
async function runOpenAi({ profile, apiKey, request, onDelta, register }) {
  const client = new OpenAI({ apiKey, baseURL: profile.baseUrl || undefined })
  const controller = new AbortController()
  register({ abort: () => controller.abort() })

  const system = request.agent ? request.system + AGENT_BLOCK_INSTRUCTION : request.system
  const stream = await client.chat.completions.create(
    {
      model: profile.model,
      stream: true,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: request.user },
      ],
    },
    { signal: controller.signal }
  )

  let text = ''
  let finishReason = null
  for await (const chunk of stream) {
    const choice = chunk.choices?.[0]
    const delta = choice?.delta?.content
    if (delta) {
      text += delta
      onDelta(delta)
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason
  }
  if (finishReason === 'length')
    return { ok: false, error: 'Réponse tronquée par le fournisseur (limite de sortie atteinte).' }
  if (finishReason === 'content_filter')
    return { ok: false, error: 'La requête a été déclinée par les filtres du fournisseur.' }
  return { ok: true, text }
}

// ------------------------------------------------------------------
// Enregistrement des canaux IPC
// ------------------------------------------------------------------
function registerAiIpc() {
  /** Requêtes en cours, par requestId : { abort() } (pour l'annulation). */
  const running = new Map()

  ipcMain.handle('ai:get-config', () => publicConfig(loadConfig()))

  // Création ou mise à jour d'un profil. apiKey absente = clé existante conservée.
  ipcMain.handle('ai:save-profile', (_e, { id, name, api, baseUrl, model, apiKey }) => {
    const config = loadConfig()
    const existing = id ? config.profiles.find((p) => p.id === id) : null
    const profile = existing ?? { id: crypto.randomUUID(), key: null }
    profile.name = String(name || '').trim() || 'Modèle sans nom'
    profile.api = api === 'anthropic' ? 'anthropic' : 'openai'
    profile.baseUrl = String(baseUrl || '').trim().replace(/\/+$/, '')
    profile.model = String(model || '').trim()
    if (typeof apiKey === 'string' && apiKey.trim()) profile.key = encryptKey(apiKey.trim())
    if (!existing) {
      config.profiles.push(profile)
      if (!config.activeProfileId) config.activeProfileId = profile.id
    }
    saveConfig(config)
    return publicConfig(config)
  })

  ipcMain.handle('ai:delete-profile', (_e, id) => {
    const config = loadConfig()
    config.profiles = config.profiles.filter((p) => p.id !== id)
    if (config.activeProfileId === id) config.activeProfileId = config.profiles[0]?.id ?? null
    saveConfig(config)
    return publicConfig(config)
  })

  ipcMain.handle('ai:set-active-profile', (_e, id) => {
    const config = loadConfig()
    if (config.profiles.some((p) => p.id === id)) config.activeProfileId = id
    saveConfig(config)
    return publicConfig(config)
  })

  ipcMain.on('ai:cancel', (_e, requestId) => {
    running.get(requestId)?.abort()
  })

  ipcMain.handle('ai:run', async (event, req) => {
    const config = loadConfig()
    const active = publicConfig(config).activeProfileId
    const profile = config.profiles.find((p) => p.id === active)
    if (!profile) return { ok: false, error: 'Aucun modèle configuré. Ouvrez les paramètres IA.' }
    const apiKey = readApiKey(profile)
    if (!apiKey)
      return { ok: false, error: `Aucune clé API pour « ${profile.name} ». Modifiez le profil dans les paramètres IA.` }

    let request
    try {
      request = buildRequest(req)
    } catch (err) {
      return friendlyError(err, false)
    }

    const onDelta = (delta) => {
      if (!event.sender.isDestroyed())
        event.sender.send('ai:progress', { requestId: req.requestId, delta })
    }
    const register = (handle) => running.set(req.requestId, handle)
    let aborted = false
    register({ abort: () => (aborted = true) }) // annulation avant l'ouverture du flux

    try {
      const runner = profile.api === 'anthropic' ? runAnthropic : runOpenAi
      const result = await runner({
        profile,
        apiKey,
        request,
        onDelta,
        register: (handle) => {
          if (aborted) handle.abort()
          register(handle)
        },
      })
      if (!result.ok || !request.agent) return result

      const edits = parseAgentEdits(result.text)
      if (edits === null) {
        const excerpt = result.text.trim().slice(0, 180)
        return {
          ok: false,
          error:
            "Réponse de l'agent inexploitable. Réessayez, ou utilisez un modèle plus capable." +
            (excerpt ? `\nDébut de la réponse : « ${excerpt}… »` : ''),
        }
      }
      return { ok: true, edits }
    } catch (err) {
      return friendlyError(err, aborted)
    } finally {
      running.delete(req.requestId)
    }
  })
}

module.exports = { registerAiIpc, _internals: { parseAgentEdits } }
