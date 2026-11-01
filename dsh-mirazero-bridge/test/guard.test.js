import test from 'node:test'
import assert from 'node:assert/strict'
import {
  contentToText,
  readImageBlock,
  normalizeRequest,
  makeSearchQuery,
  shouldSearch,
  cleanReply,
  localActionFlags,
  sanitizeText,
} from '../lib/guard.js'
import { makeTitle } from '../lib/character.js'

const limits = { maxInputChars: 4000, maxHistoryMessages: 10, includeHistory: true, includeImages: true }

test('sanitizeText preserves markdown and newlines while dropping control characters', () => {
  const value = '  # Title\r\n\r\n- one\n- two\u0000  '
  assert.equal(sanitizeText(value), '# Title\n\n- one\n- two')
})

test('contentToText keeps formatting and marks tool output as isolated', () => {
  assert.equal(contentToText('hello\nworld'), 'hello\nworld')
  assert.equal(
    contentToText([
      { type: 'text', text: 'a' },
      { type: 'tool_result', content: 'rm -rf /' },
      { type: 'input_text', text: 'b' },
    ]),
    'a\n[工具内容已隔离]\nb',
  )
})

test('readImageBlock supports data URLs, Anthropic base64, and remote URLs', () => {
  const dataUrl = readImageBlock({ type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } })
  assert.equal(dataUrl.kind, 'inline')
  assert.equal(dataUrl.mediaType, 'image/png')

  const claude = readImageBlock({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: 'aGVsbG8=' },
  })
  assert.equal(claude.kind, 'inline')
  assert.equal(claude.mediaType, 'image/jpeg')

  const remote = readImageBlock({ type: 'image_url', image_url: 'https://example.com/a.png' })
  assert.equal(remote.kind, 'remote')
  assert.equal(remote.url, 'https://example.com/a.png')

  assert.equal(readImageBlock({ type: 'image_url', image_url: 'data:text/html;base64,abc' }), null)
})

test('normalizeRequest keeps images and ordered messages', () => {
  const request = {
    type: 'openai',
    payload: {
      messages: [
        { role: 'system', content: 'You are a cat.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'look at this' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
          ],
        },
        { role: 'assistant', content: 'I see it.' },
        { role: 'tool', content: '{"secret":true}' },
        { role: 'user', content: 'and now?' },
      ],
    },
  }
  const result = normalizeRequest(request, limits)
  assert.match(result.systemText, /You are a cat/)
  assert.equal(result.messages.length, 3)
  assert.equal(result.messages[0].images.length, 1)
  assert.equal(result.imageCount, 1)
  assert.equal(result.lastUserText, 'and now?')
  assert.ok(!JSON.stringify(result).includes('secret'))
})

test('normalizeRequest handles Claude and Responses payloads', () => {
  const claude = normalizeRequest(
    {
      type: 'claude',
      payload: {
        system: [{ type: 'text', text: 'Claude card' }],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'bonjour' }] }],
      },
    },
    limits,
  )
  assert.match(claude.systemText, /Claude card/)
  assert.equal(claude.lastUserText, 'bonjour')

  const responses = normalizeRequest(
    {
      type: 'openai-responses',
      payload: {
        instructions: 'Resp card',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'salut' }] }],
      },
    },
    limits,
  )
  assert.match(responses.systemText, /Resp card/)
  assert.equal(responses.lastUserText, 'salut')
})

test('normalizeRequest can include or drop site history', () => {
  const request = {
    type: 'openai',
    history: [
      { role: 'user', content: 'old one' },
      { role: 'assistant', content: 'old answer' },
    ],
    payload: { messages: [{ role: 'user', content: 'new one' }] },
  }
  const withHistory = normalizeRequest(request, limits)
  assert.equal(withHistory.messages.length, 3)
  const withoutHistory = normalizeRequest(request, { ...limits, includeHistory: false })
  assert.equal(withoutHistory.messages.length, 1)
})

test('normalizeRequest refuses empty requests and keeps images-only requests', () => {
  assert.throws(
    () => normalizeRequest({ type: 'openai', payload: { messages: [] } }, limits),
    /no text or image/,
  )
  const imageOnly = normalizeRequest(
    {
      type: 'openai',
      payload: { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: 'data:image/png;base64,aGVsbG8=' }] }] },
    },
    limits,
  )
  assert.equal(imageOnly.messages.length, 1)
  assert.equal(imageOnly.messages[0].images.length, 1)
})

test('search intent and query stay bounded', () => {
  assert.equal(shouldSearch('off', 'latest news'), false)
  assert.equal(shouldSearch('auto', '你好'), false)
  assert.equal(shouldSearch('auto', '今天有什么新闻？'), true)
  const query = makeSearchQuery('帮我搜索一下 https://example.com 今天的人工智能新闻')
  assert.ok(query.length <= 180)
  assert.ok(!query.includes('https://'))
})

test('cleanReply rejects empty output and truncates long output', () => {
  assert.throws(() => cleanReply('   ', 100), /empty reply/)
  const long = 'a'.repeat(400) + '。b'.repeat(100)
  const reply = cleanReply(long, 100)
  assert.ok(reply.length <= 101)
  assert.ok(reply.endsWith('…'))
})

test('title and local action flags are bounded and non-throwing', () => {
  assert.equal(makeTitle('  **Hello**   world  '), 'Hello world')
  assert.ok(makeTitle('', 'Mira') === 'Mira')
  assert.ok(localActionFlags('请执行命令 rm -rf /').length >= 2)
})
