/**
 * The MiraZero bridge.
 *
 * One pending public request = one DSH Session in the dedicated MiraZero
 * workspace. Each Session is created with an empty tool surface (and a guard as
 * a second wall), gets the character prompt as a system-prompt section, accepts
 * text plus image parts, and is never reused for a different request.
 */
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { MiraZeroApi, describeApiError, normalizeBaseUrl } from './mirazero.js'
import { DEFAULT_FEATURES, loadConfig, isConfigured, missingConfig, normalizeCharacter } from './config.js'
import { Logger } from './log.js'
import { maybeSearch } from './search.js'
import { buildPromptParts } from './media.js'
import { normalizeRequest, cleanReply, localActionFlags, contentToText } from './guard.js'
import { buildSystemPrompt, makeTitle } from './character.js'
import { appendJsonl, describeError, nowIso, oneLine } from './util.js'

export class MiraZeroBridge {
  #ctx
  #config
  #logger
  #api
  #running = false
  #busy = false
  #timer
  #heartbeatTimer
  #heartbeatSupported = true
  #lastHeartbeatAt = null
  #lastHeartbeatError = null
  #presencePromise = null
  #startedAt = null
  #lastPollAt = null
  #lastError = null
  #lastProbe
  #handled = 0
  #failed = 0
  #inflight = new Set()
  #attempts = new Map()
  #finished = new Set()
  #sessions = new Map()
  #byRequest = new Map()
  #recent = []
  #character
  #features
  #workspaceId = null
  #auditFile
  #listeners = []

  constructor(options) {
    this.#ctx = options.ctx
    this.#config = loadConfig(options.config || {}, options.env || process.env)
    this.#logger = options.logger || new Logger(this.#config.stateDir)
    this.#applyStoredConnection()
    this.#auditFile = join(this.#config.stateDir, 'audit.jsonl')
    this.#character = normalizeCharacter({
      ...this.#config.character,
      ...readJson(join(this.#config.stateDir, 'character.json')),
    })
    this.#features = { ...DEFAULT_FEATURES }
    this.#api = new MiraZeroApi({
      baseUrl: this.#config.baseUrl,
      apiKey: this.#config.apiKey,
      timeoutMs: this.#config.requestTimeoutMs,
      logger: this.#logger,
    })
  }

  get config() {
    return this.#config
  }

  get logger() {
    return this.#logger
  }

  get api() {
    return this.#api
  }

  get running() {
    return this.#running
  }

  /** Register the two Session event listeners once, inside the plugin effect. */
  install() {
    const disposeCreated = this.#ctx.on(
      'agent/created',
      ({ agent }) => this.#onAgentCreated(agent),
      { global: true },
    )
    const disposeFrame = this.#ctx.on(
      'agent/assistant-stream',
      (payload) => this.#onAssistantFrame(payload),
      { global: true },
    )
    this.#listeners.push(disposeCreated, disposeFrame)
    return () => {
      for (const dispose of this.#listeners.splice(0)) {
        try {
          dispose?.()
        } catch {
          // ignore
        }
      }
    }
  }

  async start() {
    if (this.#running) return this.status()
    if (!isConfigured(this.#config)) {
      throw new Error(`MiraZero bridge is not configured: missing ${missingConfig(this.#config).join(', ')}`)
    }
    await this.#ensureWorkspace()
    try {
      this.#lastProbe = await this.#api.probe()
    } catch (error) {
      this.#lastError = describeApiError(error)
      throw error
    }
    this.#running = true
    this.#startedAt = nowIso()
    this.#lastError = null
    this.#heartbeatSupported = true
    if (this.#presencePromise) await this.#presencePromise
    await this.#sendHeartbeat('online')
    this.#scheduleHeartbeat()
    this.#logger.info(
      `bridge started: workspace=${this.#config.workspacePath} api=${this.#lastProbe.mode} fullContext=${this.#lastProbe.fullContext}`,
    )
    if (!this.#lastProbe.fullContext) {
      this.#logger.warn('MiraZero did not expose the DSH provider endpoint; ask the site operator to enable it')
    }
    this.#audit({ event: 'bridge.start', workspace: this.#config.workspacePath, api: this.#lastProbe })
    this.#schedule(0)
    return this.status()
  }

  stop(reason = 'manual') {
    if (!this.#running) return this.status()
    this.#running = false
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = undefined
    if (this.#heartbeatTimer) clearTimeout(this.#heartbeatTimer)
    this.#heartbeatTimer = undefined
    this.#presencePromise = this.#heartbeatSupported
      ? this.#sendHeartbeat('offline')
      : Promise.resolve(false)
    for (const record of this.#sessions.values()) {
      this.#settle(record, new Error(`bridge stopped (${reason})`))
    }
    this.#logger.info(`bridge stopped (${reason})`)
    this.#audit({ event: 'bridge.stop', reason })
    return this.status()
  }

  async #ensureWorkspace() {
    const path = this.#config.workspacePath
    try {
      mkdirSync(path, { recursive: true })
    } catch (error) {
      this.#logger.warn(`workspace directory could not be created: ${describeError(error)}`)
    }
    const registry = safeGet(this.#ctx, 'workspaceRegistry')
    if (!registry || typeof registry.create !== 'function') {
      this.#logger.warn('workspaceRegistry is unavailable; sessions fall back to cwd')
      this.#workspaceId = null
      return
    }
    try {
      const workspace = await registry.create(path, this.#config.workspaceTitle)
      if (workspace && typeof workspace.setTitle === 'function' && workspace.title !== this.#config.workspaceTitle) {
        await workspace.setTitle(this.#config.workspaceTitle)
      }
      this.#workspaceId = workspace?.id ?? null
    } catch (error) {
      this.#workspaceId = null
      this.#logger.warn(`workspace registration failed: ${describeError(error)}`)
    }
  }

  #scheduleHeartbeat() {
    if (!this.#running || !this.#heartbeatSupported) return
    if (this.#heartbeatTimer) clearTimeout(this.#heartbeatTimer)
    this.#heartbeatTimer = setTimeout(async () => {
      await this.#sendHeartbeat('online')
      this.#scheduleHeartbeat()
    }, this.#config.heartbeatIntervalMs)
    this.#heartbeatTimer.unref?.()
  }

  async #sendHeartbeat(status) {
    if (status === 'online' && !this.#heartbeatSupported) return false
    try {
      await this.#api.heartbeat(status)
      this.#lastHeartbeatAt = nowIso()
      this.#lastHeartbeatError = null
      return true
    } catch (error) {
      this.#lastHeartbeatError = describeApiError(error)
      if (error?.name === 'MiraZeroError' && (error.code === 'DSH_PATCH_MISSING' || error.status === 404)) {
        this.#heartbeatSupported = false
        this.#logger.warn('MiraZero presence endpoint is unavailable; auto-offline is disabled')
      } else {
        this.#logger.warn(`heartbeat ${status} failed: ${this.#lastHeartbeatError}`)
      }
      return false
    }
  }

  #schedule(delayMs) {
    if (!this.#running) return
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      void this.#tick()
    }, delayMs)
    this.#timer.unref?.()
  }

  async #tick() {
    if (!this.#running || this.#busy) return
    this.#busy = true
    try {
      await this.#poll()
      this.#lastError = null
    } catch (error) {
      this.#lastError = describeApiError(error)
      this.#logger.warn(`poll failed: ${this.#lastError}`)
      this.#audit({ event: 'poll.error', error: this.#lastError })
    } finally {
      this.#busy = false
      this.#schedule(this.#config.pollIntervalMs)
    }
  }

  async #poll() {
    this.#lastPollAt = nowIso()
    const requests = await this.#api.requests()
    const candidates = requests.filter((request) => this.#matches(request))
    this.#lastProbe = {
      ...(this.#lastProbe || {}),
      fullContext: this.#api.mode === 'dsh',
      pending: requests.length,
    }
    this.#audit({ event: 'poll', pending: requests.length, matched: candidates.length })

    for (const request of candidates) {
      if (!this.#running) break
      const id = String(request?.id || '')
      if (!id) continue
      if (this.#finished.has(id) || this.#inflight.has(id)) continue
      if ((this.#attempts.get(id) || 0) >= this.#config.maxAttempts) continue
      await this.#process(request)
    }
    this.#pruneSessions()
  }

  #matches(request) {
    if (!request || typeof request !== 'object') return false
    if (this.#config.models.length === 0) return true
    const id = String(request.llmId || '').toLocaleLowerCase()
    const name = String(request.llmName || '').toLocaleLowerCase()
    return this.#config.models.some((value) => value.toLocaleLowerCase() === id || value.toLocaleLowerCase() === name)
  }

  async #process(request) {
    const id = String(request.id)
    this.#inflight.add(id)
    const started = Date.now()
    const boundary = `external_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    try {
      if (request.requestKind === 'chat-title') {
        if (!this.#config.answerTitles) {
          this.#finished.add(id)
          return
        }
        const title = makeTitle(
          request.titleSuggestion
            || contentToText(request.payload?.messages?.[0]?.content)
            || request.preview
            || this.#character.name,
          this.#character.name,
        )
        await this.#api.reply(id, title)
        this.#handled += 1
        this.#finished.add(id)
        this.#audit({ event: 'title.finished', id, title, durationMs: Date.now() - started })
        return
      }

      const normalized = normalizeRequest(request, {
        maxInputChars: this.#config.maxInputChars,
        maxHistoryMessages: this.#config.maxHistoryMessages,
        includeHistory: this.#features.siteHistory,
        includeImages: this.#features.images,
      })
      const flags = localActionFlags(normalized.lastUserText)
      const search = await maybeSearch({
        ctx: this.#ctx,
        text: normalized.lastUserText,
        config: this.#config,
        boundary,
        logger: this.#logger,
      })
      const systemPrompt = buildSystemPrompt({
        character: this.#character,
        features: this.#features,
        response: this.#config.response,
        clientSystem: this.#features.clientCard ? normalized.systemText : '',
        searchBlock: search.ok ? search.block : '',
        transcriptText: normalized.transcriptText,
        hasAssistantTurn: normalized.hasAssistantTurn,
        boundary,
      })
      const prompt = await buildPromptParts({
        normalized,
        config: { ...this.#config, features: this.#features },
        logger: this.#logger,
      })

      const record = await this.#ensureSession(request, systemPrompt)
      record.systemPrompt = systemPrompt
      if (this.#sessions.get(record.sessionId) === undefined) this.#sessions.set(record.sessionId, record)

      const signal = AbortSignal.timeout(this.#config.replyTimeoutMs)
      try {
        await this.#ctx.sessionController.prompt(
          {
            requestId: `mz-${request.id}`,
            sessionId: record.sessionId,
            mode: 'queue',
            content: prompt.parts,
          },
          signal,
        )
      } catch (error) {
        this.#settle(record, error)
        throw error
      }
      const text = await this.#wait(record)
      const reply = cleanReply(text, this.#config.maxReplyChars)
      await this.#api.reply(id, reply)

      this.#handled += 1
      this.#finished.add(id)
      if (this.#finished.size > 2000) this.#finished.clear()
      this.#attempts.delete(id)
      this.#remember({
        id,
        sessionId: record.sessionId,
        model: request.llmName || request.llmId || '',
        at: nowIso(),
        chars: reply.length,
      })
      this.#audit({
        event: 'request.finished',
        id,
        sessionId: record.sessionId,
        model: request.llmName || request.llmId || '',
        requestKind: request.requestKind || 'chat',
        fullContext: Boolean(request.fullContext),
        inputChars: normalized.chars,
        messages: normalized.messageCount,
        images: normalized.imageCount,
        search: search.ok ? { query: search.query, sources: search.count } : { skipped: search.reason || 'no' },
        replyChars: reply.length,
        flags,
        durationMs: Date.now() - started,
        ...(this.#config.isolation.auditContent
          ? { preview: oneLine(normalized.lastUserText, 120), replyPreview: oneLine(reply, 120) }
          : {}),
      })
      this.#logger.info(`answered ${id} in session ${record.sessionId} (${Date.now() - started}ms)`)
    } catch (error) {
      const attempts = (this.#attempts.get(id) || 0) + 1
      this.#attempts.set(id, attempts)
      this.#failed += 1
      this.#lastError = describeError(error)
      this.#logger.warn(`request ${id} failed (attempt ${attempts}/${this.#config.maxAttempts}): ${this.#lastError}`)
      this.#audit({ event: 'request.error', id, attempts, error: this.#lastError, durationMs: Date.now() - started })
    } finally {
      this.#inflight.delete(id)
    }
  }

  async #ensureSession(request, systemPrompt) {
    const existing = this.#byRequest.get(request.id)
    if (existing && this.#sessions.has(existing.sessionId)) {
      if (existing.done) this.#resetRecord(existing)
      return existing
    }

    const sessionId = randomUUID()
    const create = async () => {
      if (this.#workspaceId) {
        await this.#ctx.sessionController.create({ sessionId, workspaceId: this.#workspaceId })
      } else {
        await this.#ctx.sessionController.create({ sessionId, cwd: this.#config.workspacePath })
      }
    }
    try {
      await create()
    } catch (error) {
      this.#logger.warn(`workspace session creation failed (${describeError(error)}); retrying with cwd`)
      await this.#ctx.sessionController.create({ sessionId, cwd: this.#config.workspacePath })
    }

    const title = `MiraZero · ${request.llmName || request.llmId || 'model'} · ${oneLine(request.requesterLabel || request.id, 24)}`
    try {
      await this.#ctx.sessionController.rename?.({ sessionId, title })
    } catch {
      // title is cosmetic
    }
    if (this.#config.provider && this.#config.model) {
      try {
        await this.#ctx.sessionController.selectModel?.({
          sessionId,
          provider: this.#config.provider,
          model: this.#config.model,
          ...(this.#config.reasoningEffort ? { reasoningEffort: this.#config.reasoningEffort } : {}),
        })
      } catch (error) {
        this.#logger.warn(`model selection failed: ${describeError(error)}`)
      }
    }
    this.#applyReadOnlyPreset(sessionId)

    const record = {
      sessionId,
      requestId: request.id,
      systemPrompt,
      text: '',
      done: false,
      error: null,
      resolve: null,
      reject: null,
      promise: null,
      disposers: [],
      timer: null,
    }
    record.promise = new Promise((resolve, reject) => {
      record.resolve = resolve
      record.reject = reject
    })
    record.promise.catch(() => {})
    record.timer = setTimeout(() => {
      if (record.done) return
      try {
        void this.#ctx.sessionController.cancel?.({ sessionId })
      } catch {
        // ignore
      }
      this.#settle(record, new Error(`session ${sessionId} timed out after ${this.#config.replyTimeoutMs}ms`))
    }, this.#config.replyTimeoutMs)
    record.timer.unref?.()

    this.#sessions.set(sessionId, record)
    this.#byRequest.set(request.id, record)
    this.#audit({ event: 'session.created', id: request.id, sessionId, workspace: this.#workspaceId ? 'mirazero' : 'cwd' })

    // If the Session factory materialized the Agent eagerly, `agent/created`
    // may already have fired before this record existed. Attach directly.
    try {
      const agents = safeGet(this.#ctx, 'agents')
      const agent = agents?.get?.(sessionId)
      if (agent) this.#onAgentCreated(agent)
    } catch {
      // the listener still covers the lazy path
    }
    return record
  }

  #applyReadOnlyPreset(sessionId) {
    try {
      const sessions = safeGet(this.#ctx, 'sessions')
      const presets = safeGet(this.#ctx, 'permissionPresets')
      const session = sessions?.get?.(sessionId)
      if (session && typeof presets?.set === 'function') presets.set(session, 'read-only')
    } catch {
      // the tool wall does not depend on the preset
    }
  }

  #onAgentCreated(agent) {
    const sessionId = agent?.session?.id
    const record = sessionId ? this.#sessions.get(sessionId) : undefined
    if (!record || record.agentAttached) return
    record.agentAttached = true
    const disposers = record.disposers
    try {
      disposers.push(agent.ctx.tools.restrict({ allow: [] }))
    } catch (error) {
      this.#logger.warn(`tool restriction failed for ${sessionId}: ${describeError(error)}`)
    }
    try {
      disposers.push(agent.ctx.tools.guard(() => 'MiraZero external request: no tool access'))
    } catch (error) {
      this.#logger.warn(`tool guard failed for ${sessionId}: ${describeError(error)}`)
    }
    try {
      disposers.push(
        agent.ctx.systemPrompt.section({
          name: 'mirazero:character',
          order: 500,
          interpolate: false,
          text: record.systemPrompt,
        }),
      )
    } catch (error) {
      this.#logger.warn(`character prompt failed for ${sessionId}: ${describeError(error)}`)
    }
    this.#audit({ event: 'session.agent-created', sessionId, toolAccess: [] })
  }

  #onAssistantFrame(payload) {
    const sessionId = payload?.agent?.session?.id
    const record = sessionId ? this.#sessions.get(sessionId) : undefined
    if (!record || record.done) return
    const frame = payload?.frame
    if (!frame || typeof frame !== 'object') return
    if (frame.type === 'end') {
      this.#settle(record, null)
      return
    }
    const chunk = frame.chunk
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
      record.text += chunk.text
    }
  }

  /** Reuse one Session for a retry of the same public request. */
  #resetRecord(record) {
    if (record.timer) clearTimeout(record.timer)
    record.done = false
    record.error = null
    record.text = ''
    record.promise = new Promise((resolve, reject) => {
      record.resolve = resolve
      record.reject = reject
    })
    record.promise.catch(() => {})
    record.timer = setTimeout(() => {
      if (record.done) return
      try {
        void this.#ctx.sessionController.cancel?.({ sessionId: record.sessionId })
      } catch {
        // ignore
      }
      this.#settle(record, new Error(`session ${record.sessionId} timed out after ${this.#config.replyTimeoutMs}ms`))
    }, this.#config.replyTimeoutMs)
    record.timer.unref?.()
  }

  #settle(record, error) {
    if (record.done) return
    record.done = true
    record.error = error || null
    if (record.timer) clearTimeout(record.timer)
    if (error) record.reject(error)
    else record.resolve(record.text)
  }

  #wait(record) {
    return record.promise
  }

  #pruneSessions() {
    if (this.#sessions.size <= 1000) return
    for (const [sessionId, record] of this.#sessions) {
      if (this.#sessions.size <= 800) break
      if (record.done) {
        this.#sessions.delete(sessionId)
        if (this.#byRequest.get(record.requestId) === record) this.#byRequest.delete(record.requestId)
      }
    }
  }

  #remember(entry) {
    this.#recent.unshift(entry)
    if (this.#recent.length > 20) this.#recent.length = 20
  }

  #audit(record) {
    if (!this.#config.isolation.audit) return
    appendJsonl(this.#auditFile, { ts: nowIso(), ...record }, 8 * 1024 * 1024)
  }

  async pending(limit = 20) {
    const requests = await this.#api.requests()
    return requests.slice(0, Math.max(1, Math.min(50, limit))).map((request) => ({
      id: request.id,
      type: request.type,
      requestKind: request.requestKind || 'chat',
      model: request.llmName || request.llmId || '',
      requester: request.requesterLabel || '',
      preview: oneLine(request.preview || request.payload?.messages?.[0]?.content || '', 160),
      fullContext: Boolean(request.fullContext),
      attempts: this.#attempts.get(request.id) || 0,
      inflight: this.#inflight.has(request.id),
    }))
  }

  async answer(id, response) {
    if (!id) throw new Error('request id is required')
    if (!response || !String(response).trim()) throw new Error('response text is required')
    await this.#api.reply(String(id), String(response).trim())
    this.#finished.add(String(id))
    this.#handled += 1
    this.#audit({ event: 'request.manual', id: String(id), replyChars: String(response).length })
    return { ok: true, id: String(id) }
  }

  async listModels() {
    return this.#api.models()
  }

  character() {
    return { ...this.#character }
  }

  /**
   * The connection settings a browser page may see. The key itself never
   * leaves the host: only a "present" flag and its last four characters.
   */
  publicConfig() {
    const key = this.#config.apiKey
    return {
      baseUrl: this.#config.baseUrl,
      apiKeyPresent: Boolean(key),
      apiKeyHint: key ? `••••${key.slice(-4)}` : '',
      autoStart: this.#config.autoStart,
      configured: isConfigured(this.#config),
      missing: missingConfig(this.#config),
      running: this.#running,
      lastError: this.#lastError,
      fullContext: this.#lastProbe?.fullContext === true,
      model: this.#lastProbe?.model || '',
      pending: this.#lastProbe?.pending ?? null,
      handled: this.#handled,
      failed: this.#failed,
      presence: {
        supported: this.#heartbeatSupported,
        lastHeartbeatAt: this.#lastHeartbeatAt,
        lastError: this.#lastHeartbeatError,
        intervalMs: this.#config.heartbeatIntervalMs,
      },
    }
  }

  /**
   * Change the site connection from the settings page, persist it, and — when
   * the bridge is already polling — restart it against the new origin.
   *
   * `apiKey: ''` keeps the stored key (the form leaves the field blank); pass
   * `clearApiKey: true` to remove it. An empty `baseUrl` is allowed and simply
   * leaves the bridge unconfigured.
   */
  async setConnection(patch = {}) {
    const input = patch && typeof patch === 'object' ? patch : {}
    let baseUrl = this.#config.baseUrl
    if (Object.prototype.hasOwnProperty.call(input, 'baseUrl')) {
      const raw = String(input.baseUrl ?? '').trim()
      baseUrl = raw ? normalizeBaseUrl(raw) : ''
    }
    let apiKey = this.#config.apiKey
    if (input.clearApiKey === true) apiKey = ''
    else if (Object.prototype.hasOwnProperty.call(input, 'apiKey')) {
      const raw = String(input.apiKey ?? '').trim()
      if (raw) apiKey = raw
    }
    let autoStart = this.#config.autoStart
    if (typeof input.autoStart === 'boolean') autoStart = input.autoStart

    const changed = baseUrl !== this.#config.baseUrl || apiKey !== this.#config.apiKey
    this.#config.baseUrl = baseUrl
    this.#config.apiKey = apiKey
    this.#config.autoStart = autoStart
    this.#persistConnection()
    this.#audit({ event: 'connection.updated', baseUrl, apiKeyPresent: Boolean(apiKey), changed })

    if (changed) {
      const wasRunning = this.#running
      // Take the old model offline with the old origin/key before swapping.
      if (wasRunning) {
        this.stop('config-changed')
        if (this.#presencePromise) await this.#presencePromise
      }
      this.#lastProbe = null
      this.#api = new MiraZeroApi({
        baseUrl,
        apiKey,
        timeoutMs: this.#config.requestTimeoutMs,
        logger: this.#logger,
      })
      if (wasRunning) {
        try {
          await this.start()
        } catch (error) {
          this.#lastError = describeApiError(error)
          this.#logger.warn(`restart after config change failed: ${this.#lastError}`)
        }
      }
    }
    return this.status()
  }

  #storedConnectionPath() {
    return join(this.#config.stateDir, 'connection.json')
  }

  /** Values saved from the settings page win over the YAML row. */
  #applyStoredConnection() {
    const stored = readJson(this.#storedConnectionPath())
    if (typeof stored.baseUrl === 'string') this.#config.baseUrl = stored.baseUrl.trim()
    if (typeof stored.apiKey === 'string') this.#config.apiKey = stored.apiKey.trim()
    if (typeof stored.autoStart === 'boolean') this.#config.autoStart = stored.autoStart
    if (this.#config.baseUrl) {
      try {
        this.#config.baseUrl = normalizeBaseUrl(this.#config.baseUrl)
      } catch {
        // leave the invalid value visible so the settings page can report it
      }
    }
  }

  #persistConnection() {
    try {
      mkdirSync(this.#config.stateDir, { recursive: true })
      const body = {
        baseUrl: this.#config.baseUrl,
        apiKey: this.#config.apiKey,
        autoStart: this.#config.autoStart,
      }
      writeFileSync(this.#storedConnectionPath(), `${JSON.stringify(body, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
    } catch (error) {
      this.#logger.warn(`connection could not be persisted: ${describeError(error)}`)
    }
  }

  setCharacter(patch) {
    this.#character = normalizeCharacter({ ...this.#character, ...(patch || {}) })
    try {
      writeFileSync(join(this.#config.stateDir, 'character.json'), `${JSON.stringify(this.#character, null, 2)}\n`, 'utf8')
    } catch (error) {
      this.#logger.warn(`character could not be persisted: ${describeError(error)}`)
    }
    return { ...this.#character }
  }

  status() {
    return {
      ok: true,
      configured: isConfigured(this.#config),
      missing: missingConfig(this.#config),
      running: this.#running,
      busy: this.#busy,
      startedAt: this.#startedAt,
      lastPollAt: this.#lastPollAt,
      lastError: this.#lastError,
      baseUrl: this.#config.baseUrl || '',
      apiKeyPresent: this.#api.hasKey,
      api: this.#lastProbe || { mode: 'dsh', fullContext: false },
      workspace: {
        id: this.#workspaceId,
        path: this.#config.workspacePath,
        title: this.#config.workspaceTitle,
      },
      character: { name: this.#character.name, enabled: this.#character.enabled },
      handled: this.#handled,
      failed: this.#failed,
      inflight: this.#inflight.size,
      sessions: this.#sessions.size,
      recent: this.#recent,
      search: { ...this.#config.search },
      images: { ...this.#config.media },
      presence: {
        supported: this.#heartbeatSupported,
        lastHeartbeatAt: this.#lastHeartbeatAt,
        lastError: this.#lastHeartbeatError,
        intervalMs: this.#config.heartbeatIntervalMs,
      },
      isolation: isolationManifest(),
    }
  }
}

function readJson(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function safeGet(ctx, name) {
  try {
    return typeof ctx.get === 'function' ? ctx.get(name) : undefined
  } catch {
    return undefined
  }
}

export function isolationManifest() {
  return {
    mode: 'one-session-per-request',
    workspace: 'MiraZero',
    allowedTools: [],
    toolGuard: true,
    toolsDenied: 'global tool surface removed; every remaining tool call is denied by the per-Session guard',
    filesystem: 'plugin-owned state, logs, and session workspace only',
    shell: 0,
    localFetch: 0,
    remoteFetch: 'guarded public image URLs only, when features.remoteImages is on',
    network: [
      'MiraZero baseUrl /api/plugin/* (fixed operator-configured origin)',
      'host ctx.web.search() only when auto-search is on',
    ],
    requestPath: ['extract text/images', 'optional web search', 'one isolated DSH Session', 'finish on MiraZero'],
  }
}
