import test from 'node:test'
import assert from 'node:assert/strict'
import { MiraZeroApi, normalizeBaseUrl } from '../lib/mirazero.js'

function response(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

test('normalizeBaseUrl accepts the Integrations Base URL and strips it', () => {
  assert.equal(normalizeBaseUrl('https://mz.example/'), 'https://mz.example')
  assert.equal(normalizeBaseUrl('https://mz.example/api/integrations/v1'), 'https://mz.example')
  assert.equal(normalizeBaseUrl('https://mz.example/api/integrations/v1/'), 'https://mz.example')
  assert.equal(normalizeBaseUrl('https://mz.example/v1'), 'https://mz.example')
  assert.equal(normalizeBaseUrl('http://127.0.0.1:3000/base/'), 'http://127.0.0.1:3000/base')
  assert.throws(() => normalizeBaseUrl(''), /empty/)
  assert.throws(() => normalizeBaseUrl('ftp://x'), /http or https/)
  assert.throws(() => normalizeBaseUrl('https://user:pass@x'), /credentials/)
})

test('client sends the user API key as Bearer and x-api-key', async () => {
  let seen
  const api = new MiraZeroApi({
    baseUrl: 'https://mz.example',
    apiKey: 'mz_secret',
    fetchImpl: async (url, options) => {
      seen = { url, options }
      return response({ ok: true, requests: [{ id: 'r1', payload: { messages: [] }, type: 'openai' }] })
    },
  })
  const requests = await api.requests()
  assert.equal(requests[0].id, 'r1')
  assert.equal(seen.options.headers.authorization, 'Bearer mz_secret')
  assert.equal(seen.options.headers['x-api-key'], 'mz_secret')
  assert.equal(seen.options.headers['x-mirazero-plugin-token'], undefined)
  assert.match(String(seen.url), /\/api\/plugin\/dsh\/requests/)
})

test('models use the new integrations endpoint', async () => {
  let seen
  const api = new MiraZeroApi({
    baseUrl: 'https://mz.example',
    apiKey: 'mz_secret',
    fetchImpl: async (url) => {
      seen = String(url)
      return response({ object: 'list', data: [{ id: 'mira', name: 'Mira', provider: 'MiraZero', status: 'online' }] })
    },
  })
  const models = await api.models()
  assert.equal(models[0].id, 'mira')
  assert.match(seen, /\/api\/integrations\/v1\/models/)
})

test('reply uses the DSH provider endpoint', async () => {
  let call
  const api = new MiraZeroApi({
    baseUrl: 'https://mz.example',
    apiKey: 'mz_secret',
    fetchImpl: async (url, options) => {
      call = { url: String(url), body: options.body }
      return response({ success: true })
    },
  })
  await api.reply('r1', 'hello')
  assert.match(call.url, /\/api\/plugin\/dsh\/reply/)
  assert.equal(JSON.parse(call.body).response, 'hello')
})

test('a missing DSH patch produces an actionable error', async () => {
  const api = new MiraZeroApi({
    baseUrl: 'https://mz.example',
    apiKey: 'mz_secret',
    fetchImpl: async () => response({ statusMessage: 'not found' }, { status: 404 }),
  })
  await assert.rejects(() => api.requests(), /mirazero-patch|DSH_PATCH_MISSING/)
})

test('redirect responses fail instead of being followed', async () => {
  const api = new MiraZeroApi({
    baseUrl: 'https://mz.example',
    apiKey: 'mz_secret',
    fetchImpl: async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/' } }),
  })
  await assert.rejects(() => api.requests(), /redirected|integration API failed/)
})

test('keyless configuration still sends no authorization header', async () => {
  let headers
  const api = new MiraZeroApi({
    baseUrl: 'https://mz.example',
    fetchImpl: async (_url, options) => {
      headers = options.headers
      return response({ models: [] })
    },
  })
  await api.models()
  assert.equal(headers.authorization, undefined)
  assert.equal(api.hasKey, false)
})
