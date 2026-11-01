/** Small dependency-free helpers shared by the bridge modules. */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export const rid = () => randomUUID()

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export const nowIso = () => new Date().toISOString()

export function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

export function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

export function oneLine(text, limit = 160) {
  const flat = asString(text).replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : `${flat.slice(0, Math.max(0, limit - 1))}…`
}

export function truncate(text, limit) {
  const s = asString(text)
  return s.length <= limit ? s : s.slice(0, limit)
}

/** A bounded, sentence-ish cut that never splits a surrogate pair. */
export function truncateAtBoundary(text, limit) {
  const s = asString(text)
  if (s.length <= limit) return s
  const sliced = s.slice(0, limit)
  const lastBreak = Math.max(
    sliced.lastIndexOf('\n'),
    sliced.lastIndexOf('。'),
    sliced.lastIndexOf('！'),
    sliced.lastIndexOf('？'),
    sliced.lastIndexOf('. '),
  )
  return (lastBreak > limit * 0.6 ? sliced.slice(0, lastBreak + 1) : sliced).trimEnd() + '…'
}

export function describeError(error) {
  if (error instanceof Error) {
    const code = typeof error.code === 'string' ? ` [${error.code}]` : ''
    return `${error.name}: ${error.message}${code}`
  }
  try {
    return typeof error === 'string' ? error : JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/** Strip credentials and query strings from a URL before logging it. */
export function safeUrl(raw) {
  try {
    const url = new URL(raw)
    url.username = ''
    url.password = ''
    url.search = ''
    return url.toString()
  } catch {
    return '(invalid-url)'
  }
}

export function ensureDir(dir) {
  if (!dir) return
  mkdirSync(dir, { recursive: true })
}

/**
 * Append one JSON line, rotating once the file grows past maxBytes.
 * Logging is deliberately best-effort: an audit failure must never break a reply.
 */
export function appendJsonl(file, record, maxBytes = 8 * 1024 * 1024) {
  try {
    ensureDir(dirname(file))
    if (existsSync(file) && statSync(file).size > maxBytes) {
      renameSync(file, `${file}.1`)
    }
    appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8')
  } catch {
    // ignored on purpose
  }
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
