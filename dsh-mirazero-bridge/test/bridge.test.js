import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MiraZeroBridge } from '../lib/bridge.js'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function startSite(requests, { missing = false } = {}) {
  const state = { replies: [], prompts: [], headers: [] }
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      state.headers.push(req.headers)
      const body = raw ? JSON.parse(raw) : null
      if (missing) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ statusMessage: 'not found' }))
        return
      }
      if (url.pathname === '/api/plugin/dsh/status') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, pending: requests.length, fullContext: true }))
        return
      }
      if (url.pathname === '/api/plugin/dsh/requests') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, requests }))
        return
      }
      if (url.pathname === '/api/plugin/dsh/reply') {
        state.replies.push({ path: url.pathname, body })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
        return
      }
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ statusMessage: 'not found' }))
    })
  })
  return { server, state }
}

function fakeCtx(bridgeState) {
  const handlers = new Map()
  const sessions = new Map()
  const tools = []
  const ctx = {
    handlers,
    sessions,
    toolList: tools,
    tools: {
      register(definition) {
        tools.push(definition)
        return () => tools.splice(tools.indexOf(definition), 1)
      },
    },
    on(event, handler) {
      const list = handlers.get(event) || []
      list.push(handler)
      handlers.set(event, list)
      return () => {
        const next = (handlers.get(event) || []).filter((entry) => entry !== handler)
        handlers.set(event, next)
      }
    },
    emit(event, payload) {
      for (const handler of handlers.get(event) || []) handler(payload)
    },
    get(name) {
      if (name === 'webServer') return { register: () => () => {} }
      if (name === 'workspaceRegistry') {
        return {
          async create(path, title) {
            bridgeState.workspace = { path, title }
            return { id: 'ws-mirazero', title, setTitle: async () => {} }
          },
        }
      }
      if (name === 'sessions') return { get: (sessionId) => sessions.get(sessionId) }
      if (name === 'permissionPresets') return { set: (session, preset) => { bridgeState.preset = { session, preset } } }
      if (name === 'web') {
        return {
          async search() {
            return { sources: [{ title: 'Fixture', url: 'https://example.com', snippet: 'snippet' }] }
          },
        }
      }
      return undefined
    },
    effect(fn) {
      const cleanup = fn()
      return () => cleanup?.()
    },
    provide() {},
    sessionController: {
      async create(request) {
        bridgeState.creates.push(request)
        sessions.set(request.sessionId, { id: request.sessionId })
        return { sessionId: request.sessionId }
      },
      async rename(request) { bridgeState.renames.push(request) },
      async selectModel(request) { bridgeState.models.push(request) },
      async prompt(request, signal) {
        bridgeState.prompts.push(request)
        const agent = {
          session: { id: request.sessionId },
          ctx: {
            tools: {
              restrict(filter) {
                bridgeState.restrict.push(filter)
                return () => {}
              },
              guard(guard) {
                bridgeState.guard = guard
                return () => {}
              },
            },
            systemPrompt: {
              section(section) {
                bridgeState.sections.push(section)
                return () => {}
              },
            },
          },
        }
        setTimeout(() => {
          ctx.emit('agent/created', { agent })
          ctx.emit('agent/assistant-stream', {
            agent,
            frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'Hello from ' } },
          })
          ctx.emit('agent/assistant-stream', {
            agent,
            frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'the session.' } },
          })
          ctx.emit('agent/assistant-stream', { agent, frame: { type: 'end' } })
        }, 5)
        assert.ok(signal)
        return { accepted: true }
      },
      async cancel() {},
    },
  }
  return ctx
}

function newBridgeState() {
  return {
    creates: [],
    renames: [],
    models: [],
    prompts: [],
    restrict: [],
    guard: null,
    sections: [],
    workspace: null,
    preset: null,
  }
}

async function waitFor(predicate, timeoutMs = 4000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return false
}

function makeRequest(id, text) {
  return {
    id,
    type: 'openai',
    requestKind: 'chat',
    llmId: 'mira',
    llmName: 'Mira',
    requesterLabel: 'tester',
    timestamp: Date.now(),
    payload: {
      messages: [
        { role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: `data:image/png;base64,${PNG}` }] },
      ],
    },
  }
}

test('one public request creates one restricted Session in the MiraZero workspace', async () => {
  const requests = [makeRequest('r1', '今天有什么新闻？')]
  const { server, state } = startSite(requests)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const bridgeState = newBridgeState()
  const ctx = fakeCtx(bridgeState)
  const bridge = new MiraZeroBridge({
    ctx,
    config: {
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: 'mzi_secret',
      character: { name: 'Mira', description: 'A calm observer.' },
      pollIntervalMs: 1500,
      maxAttempts: 1,
      stateDir: mkdtempSync(join(tmpdir(), 'mz-bridge-')),
      workspacePath: mkdtempSync(join(tmpdir(), 'mz-ws-')),
    },
  })
  bridge.install()

  try {
    await bridge.start()
    assert.ok(await waitFor(() => state.replies.length === 1))
    assert.equal(state.replies[0].body.response, 'Hello from the session.')
    assert.equal(bridgeState.creates.length, 1)
    assert.equal(bridgeState.creates[0].workspaceId, 'ws-mirazero')
    assert.equal(bridgeState.prompts.length, 1)
    assert.equal(bridgeState.prompts[0].content.some((part) => part.type === 'image'), true)
    assert.deepEqual(bridgeState.restrict[0], { allow: [] })
    assert.equal(typeof bridgeState.guard, 'function')
    assert.match(bridgeState.guard(), /no tool access/)
    assert.match(bridgeState.sections[0].text, /隔离墙/)
    assert.match(bridgeState.sections[0].text, /A calm observer/)
    assert.equal(bridgeState.sections[0].interpolate, false)
    assert.equal(state.headers[0].authorization, 'Bearer mzi_secret')
    assert.equal(bridge.status().sessions, 1)
    assert.equal(bridge.status().api.fullContext, true)
    assert.equal(bridge.publicConfig().fullContext, true)
    assert.equal(bridge.publicConfig().running, true)
  } finally {
    bridge.stop('test')
    await new Promise((resolve) => server.close(resolve))
  }
})

test('two public requests get two distinct Sessions', async () => {
  const requests = [makeRequest('r1', 'first'), makeRequest('r2', 'second')]
  const { server, state } = startSite(requests)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const bridgeState = newBridgeState()
  const bridge = new MiraZeroBridge({
    ctx: fakeCtx(bridgeState),
    config: {
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: 'mzi_secret',
      provider: 'test',
      model: 'test-model',
      pollIntervalMs: 1500,
      maxAttempts: 1,
      stateDir: mkdtempSync(join(tmpdir(), 'mz-bridge-')),
      workspacePath: mkdtempSync(join(tmpdir(), 'mz-ws-')),
    },
  })
  bridge.install()

  try {
    await bridge.start()
    assert.ok(await waitFor(() => state.replies.length === 2))
    assert.equal(bridgeState.creates.length, 2)
    assert.notEqual(bridgeState.creates[0].sessionId, bridgeState.creates[1].sessionId)
    assert.equal(bridgeState.sections.length, 2)
    assert.equal(bridgeState.models.length, 2)
  } finally {
    bridge.stop('test')
    await new Promise((resolve) => server.close(resolve))
  }
})

test('settings-page connection changes are persisted and never expose the key', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'mz-config-'))
  const bridge = new MiraZeroBridge({
    ctx: fakeCtx(newBridgeState()),
    config: {
      baseUrl: 'https://old.example/api/integrations/v1',
      apiKey: 'mzi_old',
      autoStart: false,
      stateDir,
      workspacePath: mkdtempSync(join(tmpdir(), 'mz-ws-')),
    },
  })
  const before = bridge.publicConfig()
  assert.equal(before.baseUrl, 'https://old.example')
  assert.equal(before.apiKeyPresent, true)
  assert.equal(before.apiKey, undefined)
  assert.equal(before.apiKeyHint.endsWith('_old'), true)

  await bridge.setConnection({
    baseUrl: 'https://new.example/api/integrations/v1',
    apiKey: 'mzi_new_value',
    autoStart: true,
  })
  const after = bridge.publicConfig()
  assert.equal(after.baseUrl, 'https://new.example')
  assert.equal(after.apiKeyPresent, true)
  assert.equal(after.autoStart, true)
  assert.equal(after.configured, true)
  assert.equal(after.apiKeyHint.endsWith('alue'), true)

  await bridge.setConnection({ clearApiKey: true })
  const cleared = bridge.publicConfig()
  assert.equal(cleared.apiKeyPresent, false)
  assert.equal(cleared.configured, false)

  const stored = JSON.parse(readFileSync(join(stateDir, 'connection.json'), 'utf8'))
  assert.equal(stored.baseUrl, 'https://new.example')
  assert.equal(stored.apiKey, '')
  assert.equal(stored.autoStart, true)
})

test('a site without the DSH provider patch reports an actionable error', async () => {
  const { server } = startSite([], { missing: true })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const bridge = new MiraZeroBridge({
    ctx: fakeCtx(newBridgeState()),
    config: {
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: 'mzi_secret',
      pollIntervalMs: 1500,
      stateDir: mkdtempSync(join(tmpdir(), 'mz-bridge-')),
      workspacePath: mkdtempSync(join(tmpdir(), 'mz-ws-')),
    },
  })
  bridge.install()
  try {
    await assert.rejects(() => bridge.start(), /mirazero-patch|DSH_PATCH_MISSING/)
  } finally {
    bridge.stop('test')
    await new Promise((resolve) => server.close(resolve))
  }
})
