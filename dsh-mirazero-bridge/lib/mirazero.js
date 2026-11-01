/**
 * MiraZero third-party client for the DSH provider bridge.
 *
 * New MiraZero versions authenticate integrations with a **model-bound
 * integration key** (`mzi_...`) created in model settings. The same key is
 * accepted by the standard `/api/integrations/v1` model API and by the
 * companion `/api/plugin/dsh/*` endpoints that expose full pending payloads.
 *
 * Only fixed `/api/plugin/*` and `/api/integrations/*` paths on the configured
 * origin are requested; redirects are refused.
 */
import { describeError, safeUrl } from './util.js'

const INTEGRATION_SUFFIXES = ['/api/integrations/v1', '/api/openai/v1', '/api/anthropic/v1', '/v1']

export class MiraZeroError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'MiraZeroError'
    this.status = options.status
    this.code = options.code
    this.body = options.body
  }
}

export class MiraZeroApi {
  #baseUrl
  #apiKey
  #timeoutMs
  #logger
  #fetch

  constructor(options) {
    const baseUrl = String(options.baseUrl || '').trim()
    try {
      this.#baseUrl = baseUrl ? normalizeBaseUrl(baseUrl) : ''
    } catch {
      // Keep the invalid value visible so the settings page can repair it.
      this.#baseUrl = baseUrl
    }
    this.#apiKey = String(options.apiKey || '').trim()
    this.#timeoutMs = Number(options.timeoutMs) || 30000
    this.#logger = options.logger
    this.#fetch = options.fetchImpl || globalThis.fetch
    if (typeof this.#fetch !== 'function') throw new MiraZeroError('global fetch is unavailable', { code: 'NO_FETCH' })
  }

  get baseUrl() {
    return this.#baseUrl
  }

  get hasKey() {
    return Boolean(this.#apiKey)
  }

  get mode() {
    return 'dsh'
  }

  async probe() {
    const status = await this.status()
    return {
      ok: true,
      mode: 'dsh',
      fullContext: true,
      pending: Number(status?.pending) || 0,
      model: String(status?.modelName || status?.modelId || ''),
      baseUrl: safeUrl(this.#baseUrl),
      hasKey: this.hasKey,
    }
  }

  async requests() {
    const body = await this.#request('/api/plugin/dsh/requests?limit=20')
    const list = Array.isArray(body) ? body : Array.isArray(body?.requests) ? body.requests : []
    return list.map((item) => ({ ...item, fullContext: true }))
  }

  /** Public + own private online models, through the new integration API. */
  async models() {
    const body = await this.#request('/api/integrations/v1/models')
    const list = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : []
    return list.map((model) => ({
      id: model.id || model.name || '',
      name: model.name || model.id || '',
      provider: model.provider || model.owned_by || '',
      status: model.status || '',
      public: model.public !== false,
    }))
  }

  async status() {
    return this.#request('/api/plugin/dsh/status')
  }

  async reply(id, response) {
    return this.#request('/api/plugin/dsh/reply', {
      method: 'POST',
      body: { id, response, finish: true, simulateStream: false },
    })
  }

  async #request(path, options = {}) {
    if (!this.#baseUrl) throw new MiraZeroError('MiraZero baseUrl is empty', { code: 'NO_BASE_URL' })
    if (!(path.startsWith('/api/plugin/') || path.startsWith('/api/integrations/')) || path.includes('..')) {
      throw new MiraZeroError(`refused non-integration path: ${path}`, { code: 'PATH_REFUSED' })
    }
    const headers = {
      accept: 'application/json',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    }
    if (this.#apiKey) {
      headers.authorization = `Bearer ${this.#apiKey}`
      headers['x-api-key'] = this.#apiKey
    }

    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs ?? this.#timeoutMs),
      redirect: 'manual',
    })
    if (response.status >= 300 && response.status < 400) {
      throw new MiraZeroError('integration API redirected; check baseUrl', { status: response.status, code: 'REDIRECT' })
    }
    const body = await readBody(response)
    if (!response.ok) {
      const message = errorText(body, `integration API failed (HTTP ${response.status})`)
      if (response.status === 404 && path.startsWith('/api/plugin/dsh/')) {
        throw new MiraZeroError(
          `${message}; install mirazero-patch/server/api/plugin/dsh and rebuild the site`,
          { status: 404, code: 'DSH_PATCH_MISSING', body },
        )
      }
      throw new MiraZeroError(message, {
        status: response.status,
        code: response.status === 401 || response.status === 403 ? 'UNAUTHORIZED' : 'HTTP_ERROR',
        body,
      })
    }
    return body
  }
}

export function normalizeBaseUrl(raw) {
  const value = String(raw || '').trim()
  if (!value) throw new MiraZeroError('baseUrl is empty', { code: 'INVALID_BASE_URL' })
  let url
  try {
    url = new URL(value)
  } catch {
    throw new MiraZeroError(`baseUrl is not a valid URL: ${value}`, { code: 'INVALID_BASE_URL' })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new MiraZeroError('baseUrl must use http or https', { code: 'INVALID_BASE_URL' })
  }
  if (url.username || url.password) {
    throw new MiraZeroError('baseUrl must not embed credentials', { code: 'INVALID_BASE_URL' })
  }
  url.search = ''
  url.hash = ''
  let path = url.pathname.replace(/\/+$/, '')
  const suffix = INTEGRATION_SUFFIXES.find((value) => path === value || path.endsWith(value))
  if (suffix) path = path.slice(0, -suffix.length)
  url.pathname = path || '/'
  return url.toString().replace(/\/+$/, '')
}

async function readBody(response) {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > 10 * 1024 * 1024) {
    throw new MiraZeroError('site response exceeds 10 MiB', { code: 'RESPONSE_TOO_LARGE' })
  }
  const text = await response.text()
  if (text.length > 10 * 1024 * 1024) {
    throw new MiraZeroError('site response exceeds 10 MiB', { code: 'RESPONSE_TOO_LARGE' })
  }
  if (!text) return null
  const type = response.headers.get('content-type') || ''
  if (type.includes('application/json') || /^[\s]*[[{]/.test(text)) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return text
}

function errorText(body, fallback) {
  if (body && typeof body === 'object') {
    const message = body.statusMessage || body.message || body.error
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  if (typeof body === 'string' && body.trim()) return body.trim().slice(0, 300)
  return fallback
}

export function describeApiError(error) {
  return error instanceof MiraZeroError
    ? `${error.message}${error.status ? ` (HTTP ${error.status})` : ''}`
    : describeError(error)
}
