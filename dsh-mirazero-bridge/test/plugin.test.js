import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, inject, name } from '../index.js'

function fakeCtx() {
  const toolList = []
  const routes = []
  const events = []
  const ctx = {
    toolList,
    routes,
    events,
    tools: {
      register(definition) {
        toolList.push(definition)
        return () => toolList.splice(toolList.indexOf(definition), 1)
      },
    },
    get(service) {
      if (service === 'webServer') {
        return {
          register(options) {
            routes.push(options)
            return () => routes.splice(routes.indexOf(options), 1)
          },
        }
      }
      return undefined
    },
    on(event) {
      events.push(event)
      return () => {}
    },
    effect(fn) {
      const cleanup = fn()
      return () => cleanup?.()
    },
    provide() {},
    sessionController: {
      async create() {},
      async prompt() {},
    },
    sessions: { get() { return undefined } },
  }
  return ctx
}

test('plugin exports the host shape and registers tools, routes, and Session listeners', () => {
  assert.equal(name, 'dsh-mirazero-bridge')
  assert.deepEqual(inject, ['tools', 'sessionController', 'sessions', 'systemPrompt'])

  const ctx = fakeCtx()
  const stateDir = mkdtempSync(join(tmpdir(), 'mz-plugin-'))
  apply(ctx, {
    baseUrl: 'https://mz.example',
    apiKey: 'k',
    autoStart: false,
    stateDir,
    workspacePath: mkdtempSync(join(tmpdir(), 'mz-ws-')),
  })

  assert.equal(ctx.toolList.length, 8)
  assert.equal(ctx.routes.length, 1)
  assert.equal(ctx.routes[0].path, '/.dsh-mirazero-bridge')
  assert.ok(ctx.toolList.every((tool) => tool.name.startsWith('mirazero_')))
  assert.deepEqual(ctx.events, ['agent/created', 'agent/assistant-stream'])
})
