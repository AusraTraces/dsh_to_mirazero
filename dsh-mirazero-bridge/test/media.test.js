import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPromptParts, isPrivateAddress, canonicalBase64 } from '../lib/media.js'
import { normalizeRequest } from '../lib/guard.js'

const config = {
  character: { name: 'Mira' },
  features: { images: true, remoteImages: false },
  media: { maxImages: 4, maxImageBytes: 1024 * 1024, fetchTimeoutMs: 1000 },
}

test('canonicalBase64 re-encodes and rejects empty values', () => {
  assert.equal(canonicalBase64('aGVsbG8='), 'aGVsbG8=')
  assert.equal(canonicalBase64(' aGVs bG8= '), 'aGVsbG8=')
  assert.equal(canonicalBase64(''), '')
})

test('private address guard covers loopback, RFC1918, and link-local', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '192.168.1.10', '172.16.0.1', '172.31.255.1', '169.254.1.1', '100.64.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1']) {
    assert.equal(isPrivateAddress(address), true, address)
  }
  for (const address of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '192.169.0.1']) {
    assert.equal(isPrivateAddress(address), false, address)
  }
})

test('buildPromptParts passes inline images through', async () => {
  const normalized = normalizeRequest(
    {
      type: 'openai',
      payload: {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'look' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
            ],
          },
        ],
      },
    },
    { maxInputChars: 2000, maxHistoryMessages: 5, includeImages: true },
  )
  const result = await buildPromptParts({ normalized, config, logger: { warn() {} } })
  assert.equal(result.imageCount, 1)
  assert.equal(result.parts.some((part) => part.type === 'image' && part.mediaType === 'image/png'), true)
  assert.equal(result.parts.some((part) => part.type === 'text' && part.text.includes('look')), true)
})

test('images toggle off drops image parts', async () => {
  const normalized = normalizeRequest(
    {
      type: 'openai',
      payload: {
        messages: [
          { role: 'user', content: [{ type: 'image_url', image_url: 'data:image/png;base64,aGVsbG8=' }] },
        ],
      },
    },
    { maxInputChars: 2000, maxHistoryMessages: 5, includeImages: true },
  )
  const result = await buildPromptParts({
    normalized,
    config: { ...config, features: { ...config.features, images: false } },
    logger: { warn() {} },
  })
  assert.equal(result.imageCount, 0)
  assert.equal(result.dropped, 1)
})

test('remote images are refused while remoteImages is off', async () => {
  const normalized = normalizeRequest(
    {
      type: 'openai',
      payload: {
        messages: [
          { role: 'user', content: [{ type: 'image_url', image_url: 'https://example.com/a.png' }] },
        ],
      },
    },
    { maxInputChars: 2000, maxHistoryMessages: 5, includeImages: true },
  )
  const result = await buildPromptParts({ normalized, config, logger: { warn() {} } })
  assert.equal(result.imageCount, 0)
  assert.equal(result.dropped, 1)
})
