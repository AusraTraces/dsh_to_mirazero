/** Configuration normalization. All values are operator-controlled. */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { clampInt } from './util.js'

/**
 * Internal, fixed behaviour. Only the character-card switch is exposed in the
 * settings page; these values keep images, history, lorebook and examples on.
 */
export const DEFAULT_FEATURES = {
  clientCard: true,
  siteHistory: true,
  images: true,
  remoteImages: true,
  lorebook: true,
  examples: true,
  selfAwareness: true,
  postHistory: true,
  authorNote: true,
  firstMessage: false,
}

const DEFAULT_CHARACTER = {
  name: 'Mira',
  description: 'Mira 是一个冷静、敏锐、略带疏离感的角色。她习惯先观察再开口，对感兴趣的人会多问一句。',
  personality: '冷静、敏锐、克制，偶尔露出一点温柔；不喜欢被命令，也不轻易承诺。',
  scenario: '你们在一个安静的地方相遇，对方主动向 Mira 搭话。',
  speechStyle: '第一人称，句子偏短，少用感叹号；不解释自己是模型，不跳出角色。',
  relationship: '对陌生人保持礼貌的距离；熟悉之后会主动关心，但不黏人。',
  likes: '安静的环境、认真对话、被记住细节。',
  boundaries: '不替对方做决定；不假装知道没有发生的事。',
  exampleDialogue: '',
  firstMessage: '',
  authorNote: '',
  postHistory: '',
  lorebook: [],
}

export function loadConfig(raw = {}, env = process.env) {
  const search = raw.search && typeof raw.search === 'object' ? raw.search : {}
  const isolation = raw.isolation && typeof raw.isolation === 'object' ? raw.isolation : {}
  const media = raw.media && typeof raw.media === 'object' ? raw.media : {}
  const character = raw.character && typeof raw.character === 'object' ? raw.character : {}
  const response = character.response && typeof character.response === 'object' ? character.response : {}

  const stateDir = String(raw.stateDir || '').trim() || join(env.DSH_HOME || join(homedir(), '.dsh'), 'mirazero-bridge')
  const workspacePath = String(raw.workspacePath || '').trim()
    || join(env.DSH_HOME || join(homedir(), '.dsh'), 'mirazero')

  return {
    baseUrl: String(raw.baseUrl || '').trim(),
    apiKey: String(raw.apiKey || env.MIRAZERO_INTEGRATION_KEY || env.MIRAZERO_API_KEY || '').trim(),
    autoStart: raw.autoStart === true,
    models: normalizeList(raw.models),
    pollIntervalMs: clampInt(raw.pollIntervalMs, 1500, 60000, 3000),
    requestTimeoutMs: clampInt(raw.requestTimeoutMs, 5000, 120000, 30000),
    replyTimeoutMs: clampInt(raw.replyTimeoutMs, 30000, 600000, 180000),
    maxInputChars: clampInt(raw.maxInputChars, 2000, 200000, 24000),
    maxHistoryMessages: clampInt(raw.maxHistoryMessages, 2, 100, 40),
    maxReplyChars: clampInt(raw.maxReplyChars, 100, 20000, 6000),
    maxAttempts: clampInt(raw.maxAttempts, 1, 10, 3),
    answerTitles: raw.answerTitles !== false,
    provider: String(raw.provider || '').trim(),
    model: String(raw.model || '').trim(),
    reasoningEffort: String(raw.reasoningEffort || '').trim(),
    stateDir,
    workspacePath,
    workspaceTitle: String(raw.workspaceTitle || 'MiraZero').trim() || 'MiraZero',
    character: normalizeCharacter(character),
    response: {
      pov: ['first', 'third'].includes(response.pov) ? response.pov : 'first',
      length: ['short', 'medium', 'long'].includes(response.length) ? response.length : 'medium',
      format: ['chat', 'novel', 'rp'].includes(response.format) ? response.format : 'chat',
    },
    media: {
      maxImages: clampInt(media.maxImages, 0, 10, 4),
      maxImageBytes: clampInt(media.maxImageBytes, 256 * 1024, 20 * 1024 * 1024, 8 * 1024 * 1024),
      fetchTimeoutMs: clampInt(media.fetchTimeoutMs, 3000, 30000, 10000),
    },
    search: {
      mode: ['off', 'auto', 'always'].includes(search.mode) ? search.mode : 'auto',
      maxResults: clampInt(search.maxResults, 1, 10, 5),
      timeoutMs: clampInt(search.timeoutMs, 3000, 60000, 20000),
    },
    isolation: {
      audit: isolation.audit !== false,
      auditContent: isolation.auditContent === true,
    },
  }
}

export function normalizeCharacter(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    enabled: source.enabled !== false,
    name: String(source.name || DEFAULT_CHARACTER.name).trim() || DEFAULT_CHARACTER.name,
    description: pick(source.description, DEFAULT_CHARACTER.description),
    personality: pick(source.personality, DEFAULT_CHARACTER.personality),
    scenario: pick(source.scenario, DEFAULT_CHARACTER.scenario),
    speechStyle: pick(source.speechStyle, DEFAULT_CHARACTER.speechStyle),
    relationship: pick(source.relationship, DEFAULT_CHARACTER.relationship),
    likes: pick(source.likes, DEFAULT_CHARACTER.likes),
    boundaries: pick(source.boundaries, DEFAULT_CHARACTER.boundaries),
    exampleDialogue: String(source.exampleDialogue || ''),
    firstMessage: String(source.firstMessage || ''),
    authorNote: String(source.authorNote || ''),
    postHistory: String(source.postHistory || ''),
    lorebook: normalizeLorebook(source.lorebook),
  }
}

function normalizeLorebook(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const keys = normalizeList(entry.keys || entry.key)
      const content = String(entry.content || '').trim()
      if (!keys.length || !content) return null
      return { keys, content, enabled: entry.enabled !== false }
    })
    .filter(Boolean)
    .slice(0, 50)
}

export function isConfigured(config) {
  return Boolean(config.baseUrl && config.apiKey)
}

export function missingConfig(config) {
  const missing = []
  if (!config.baseUrl) missing.push('baseUrl')
  if (!config.apiKey) missing.push('apiKey (MiraZero model-bound integration key, mzi_...)')
  return missing
}

function pick(value, fallback) {
  const text = String(value || '').trim()
  return text || fallback
}

function normalizeList(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  return list
    .map((item) => String(item || '').trim())
    .filter(Boolean)
}

export function readCharacterFile(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}
