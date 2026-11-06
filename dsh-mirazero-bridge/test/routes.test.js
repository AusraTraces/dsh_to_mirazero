import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MiraZeroBridge } from '../lib/bridge.js'
import { registerRoutes } from '../lib/routes.js'

test('settings routes read and write connection/config without leaking the key', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'mz-routes-'))
  const bridge = new MiraZeroBridge({
    ctx: { get() { return undefined } },
    config: {
      baseUrl: 'https://old.example',
      apiKey: 'mzi_old_key',
      autoStart: false,
      stateDir,
      workspacePath: mkdtempSync(join(tmpdir(), 'mz-ws-')),
    },
  })

  let handler
  const dispose = registerRoutes({
    get(name) {
      if (name !== 'webServer') return undefined
      return {
        register(options) {
          handler = options.handler
          return () => { handler = undefined }
        },
      }
    },
  }, bridge)
  assert.equal(typeof handler, 'function')

  const server = createServer((req, res) => handler(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const configResponse = await fetch(`${base}/.dsh-mirazero-bridge/config`)
    const configBody = await configResponse.json()
    assert.equal(configResponse.status, 200)
    assert.equal(configBody.config.baseUrl, 'https://old.example')
    assert.equal(configBody.config.apiKeyPresent, true)
    assert.equal(configBody.config.apiKey, undefined)
    assert.equal(JSON.stringify(configBody).includes('mzi_old_key'), false)

    const saveResponse = await fetch(`${base}/.dsh-mirazero-bridge/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'https://new.example/api/integrations/v1',
        apiKey: 'mzi_new_key',
        autoStart: true,
      }),
    })
    const saveBody = await saveResponse.json()
    assert.equal(saveResponse.status, 200)
    assert.equal(saveBody.config.baseUrl, 'https://new.example')
    assert.equal(saveBody.config.autoStart, true)
    assert.equal(JSON.stringify(saveBody).includes('mzi_new_key'), false)

    const characterResponse = await fetch(`${base}/.dsh-mirazero-bridge/character`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
    const characterBody = await characterResponse.json()
    assert.equal(characterBody.character.enabled, false)

    const badResponse = await fetch(`${base}/.dsh-mirazero-bridge/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'ftp://bad.example' }),
    })
    assert.equal(badResponse.status, 400)
  } finally {
    dispose()
    await new Promise((resolve) => server.close(resolve))
  }
})
