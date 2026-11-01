import test from 'node:test'
import assert from 'node:assert/strict'

test('client module registers a settings section without throwing', async () => {
  const definitions = []
  globalThis.window = {
    __ModuleLoader__: {
      load(definition) {
        definitions.push(definition)
      },
    },
  }
  globalThis.document = {
    documentElement: { lang: 'zh-CN' },
    getElementById() { return null },
    createElement() { return { id: '', textContent: '', remove() {} } },
    head: { append() {} },
  }
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { language: 'zh-CN' },
  })

  await import('../client.js')
  assert.equal(definitions.length, 1)
  assert.equal(definitions[0].id, 'dsh-mirazero-bridge')

  const React = {
    createElement() { return {} },
    useCallback(fn) { return fn },
    useEffect() {},
    useState(value) { return [value, () => {}] },
  }
  const module = definitions[0].factory((id) => {
    assert.equal(id, 'react')
    return React
  })
  assert.equal(module.name, 'dsh-mirazero-bridge')
  assert.deepEqual(module.inject, ['slots'])

  const registrations = []
  const ctx = {
    effect(fn) {
      const cleanup = fn()
      return () => cleanup?.()
    },
    slots: {
      inject(name, contribute) {
        assert.equal(name, 'settings.section')
        return contribute()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  module.apply(ctx)
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].options.name, 'settings.section')
  assert.equal(registrations[0].options.id, 'mirazero')
  assert.equal(typeof registrations[0].component, 'function')
})
