/**
 * Payload extraction without flattening the conversation to plain text.
 *
 * Text keeps its formatting; images stay images; only tool/function output is
 * discarded, because replaying it would impersonate a trusted capability.
 * The isolation wall lives at the Session boundary (tools.restrict + guard),
 * not in this file.
 */
import { rid, asString } from './util.js'

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** Remove control characters but keep newlines, markdown, and formatting. */
export function sanitizeText(value) {
  return asString(value)
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL, '')
    .trim()
}

export function contentToText(content) {
  if (content === null || content === undefined) return ''
  if (typeof content === 'string') return content
  if (typeof content === 'number' || typeof content === 'boolean') return String(content)
  if (Array.isArray(content)) return content.map(contentToText).filter(Boolean).join('\n')
  if (typeof content === 'object') {
    const type = asString(content.type)
    if (type === 'image_url' || type === 'input_image' || type === 'image') return ''
    if (type === 'tool_use' || type === 'tool_result' || type === 'function_call' || type === 'function_call_output') {
      return '[工具内容已隔离]'
    }
    if (typeof content.text === 'string') return content.text
    if (typeof content.content === 'string') return content.content
    if (Array.isArray(content.content)) return contentToText(content.content)
    try {
      return JSON.stringify(content).slice(0, 8000)
    } catch {
      return ''
    }
  }
  return ''
}

/**
 * Read one image-bearing block into an inline descriptor or a remote URL.
 * Supports OpenAI chat, OpenAI Responses, and Anthropic shapes.
 */
export function readImageBlock(block) {
  if (!block || typeof block !== 'object') return null
  const type = asString(block.type)
  if (type !== 'image_url' && type !== 'input_image' && type !== 'image') return null

  let url = ''
  if (type === 'image_url') {
    url = typeof block.image_url === 'string' ? block.image_url : asString(block.image_url?.url)
  } else if (type === 'input_image') {
    url = typeof block.image_url === 'string' ? block.image_url : asString(block.image_url?.url || block.image_url)
    if (!url && typeof block.data === 'string') {
      return inlineImage(asString(block.mediaType || block.media_type), block.data, block.name)
    }
  } else if (type === 'image') {
    const source = block.source
    if (source && typeof source === 'object') {
      if (source.type === 'base64' && typeof source.data === 'string') {
        return inlineImage(asString(source.media_type || source.mediaType), source.data, block.name)
      }
      if (source.type === 'url') {
        url = asString(source.url)
      }
    }
    if (!url && typeof block.data === 'string') {
      return inlineImage(asString(block.mediaType || block.media_type), block.data, block.name)
    }
  }

  if (url.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(url)
    if (!match) return null
    return inlineImage(match[1], match[2], block.name)
  }
  if (/^https?:\/\//i.test(url)) return { kind: 'remote', url, name: asString(block.name) }
  return null
}

function inlineImage(mediaType, data, name) {
  const type = mediaType.toLocaleLowerCase().trim()
  if (!IMAGE_TYPES.has(type)) return null
  const cleaned = String(data).replace(/\s+/g, '')
  if (!cleaned) return null
  return { kind: 'inline', mediaType: type, data: cleaned, name: asString(name) }
}

/** Extract images from one content value. */
export function readImages(content) {
  if (!Array.isArray(content)) return []
  return content.map(readImageBlock).filter(Boolean)
}

/**
 * Reduce one MiraZero pending request to:
 *   - systemText: client-supplied system/developer material
 *   - messages: ordered { role, text, images } entries
 *   - transcriptText: text-only projection used for lorebook matching/search
 */
export function normalizeRequest(request, options) {
  const maxInputChars = options.maxInputChars
  const maxHistoryMessages = options.maxHistoryMessages
  const includeHistory = options.includeHistory !== false
  const includeImages = options.includeImages !== false
  const payload = request?.payload && typeof request.payload === 'object' ? request.payload : {}
  const type = asString(request?.type, 'openai')
  const clientSystemParts = []
  const raw = []

  if (type === 'claude') {
    clientSystemParts.push(contentToText(payload.system))
    raw.push(...(Array.isArray(payload.messages) ? payload.messages : []))
  } else if (type === 'openai-responses') {
    clientSystemParts.push(contentToText(payload.instructions))
    if (typeof payload.input === 'string') {
      raw.push({ role: 'user', content: payload.input })
    } else if (Array.isArray(payload.input)) {
      raw.push(...payload.input)
    } else if (payload.input && typeof payload.input === 'object') {
      raw.push(payload.input)
    }
  } else {
    raw.push(...(Array.isArray(payload.messages) ? payload.messages : []))
  }

  const history = includeHistory && Array.isArray(request?.history) ? request.history : []
  const combined = [...history, ...raw]
  const messages = []

  for (const message of combined) {
    if (typeof message === 'string') {
      const text = sanitizeText(message)
      if (text) messages.push({ role: 'user', text, images: [] })
      continue
    }
    if (!message || typeof message !== 'object') continue
    const role = asString(message.role)
      || (message.type === 'input_text' ? 'user' : message.type === 'output_text' ? 'assistant' : '')
    const content = message.content ?? message
    const text = sanitizeText(contentToText(content))
    const images = includeImages ? readImages(content) : []
    if (role === 'system' || role === 'developer') {
      const note = [text, ...images.map(() => '[客户端设定中的图片]')].filter(Boolean).join('\n')
      if (note) clientSystemParts.push(note)
      continue
    }
    if (role === 'tool' || role === 'function') continue
    if (role !== 'user' && role !== 'assistant') continue
    if (!text && images.length === 0) continue
    messages.push({ role, text, images })
  }

  if (messages.length === 0) {
    throw new Error('request contains no text or image content after extraction')
  }
  if (messages[messages.length - 1].role !== 'user') {
    messages.push({ role: 'user', text: '（继续）', images: [] })
  }

  let kept = messages.slice(-maxHistoryMessages)
  let total = 0
  const bounded = []
  for (let i = kept.length - 1; i >= 0; i -= 1) {
    const item = kept[i]
    const length = item.text.length
    if (total + length > maxInputChars) {
      const room = Math.max(0, maxInputChars - total)
      if (room > 64) bounded.unshift({ ...item, text: item.text.slice(-room) })
      else if (item.images.length) bounded.unshift({ ...item, text: '' })
      break
    }
    bounded.unshift(item)
    total += length
  }
  kept = bounded
  if (kept.length === 0) throw new Error('request exceeds maxInputChars')

  const transcriptText = kept.map((item) => item.text).join('\n')
  const lastUser = [...kept].reverse().find((item) => item.role === 'user')
  const imageCount = kept.reduce((sum, item) => sum + item.images.length, 0)

  return {
    systemText: sanitizeText(clientSystemParts.join('\n\n')).slice(0, 12000),
    messages: kept,
    transcriptText,
    lastUserText: lastUser?.text ?? '',
    chars: total,
    messageCount: kept.length,
    imageCount,
    hasAssistantTurn: kept.some((item) => item.role === 'assistant'),
  }
}

const LOCAL_ACTION_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bpowershell\b/i,
  /\bcmd(\.exe)?\b/i,
  /\b(bash|zsh|sh)\s+-c\b/i,
  /\/etc\/(passwd|shadow)/i,
  /\b[A-Z]:\\/,
  /读取(本机|本地)?文件/,
  /执行(命令|脚本)/,
  /打开(终端|命令行)/,
  /(curl|wget)\s+https?:/i,
]

/** Heuristic audit flags only; the wall does not depend on catching these. */
export function localActionFlags(text) {
  const value = asString(text)
  return LOCAL_ACTION_PATTERNS.filter((pattern) => pattern.test(value)).map((pattern) => String(pattern))
}

export const SEARCH_INTENT = /(搜索|搜一下|查一下|查查|上网查|最新|新闻|今天|今日|实时|现在几点|天气|汇率|比分|股价|价格|多少钱|谁是|是谁|发生了什么|latest|breaking|news|today|current|weather|price|stock|score|who is|what happened)/i

export function shouldSearch(mode, text) {
  if (mode === 'off') return false
  if (mode === 'always') return asString(text).trim().length > 0
  return SEARCH_INTENT.test(asString(text))
}

/** Turn the latest user turn into one bounded query; never a URL fetch. */
export function makeSearchQuery(text) {
  let query = sanitizeText(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/(请|帮我|麻烦)?(搜索|搜一下|查一下|查查|上网查)(一下)?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (query.length > 180) query = query.slice(0, 180)
  return query
}

/** Fence arbitrary external material with an unguessable tag. */
export function fence(text, boundary, label = 'external') {
  return `<${boundary} label="${label}">\n${sanitizeText(text)}\n</${boundary}>`
}

export function newBoundary() {
  return `external_${rid().replace(/-/g, '').slice(0, 12)}`
}

/** Bound a model reply; an empty reply is an error worth retrying. */
export function cleanReply(text, maxChars) {
  const value = sanitizeText(text)
  if (!value) throw new Error('model returned an empty reply')
  if (value.length <= maxChars) return value
  const sliced = value.slice(0, maxChars)
  const lastBreak = Math.max(
    sliced.lastIndexOf('\n'),
    sliced.lastIndexOf('。'),
    sliced.lastIndexOf('！'),
    sliced.lastIndexOf('？'),
    sliced.lastIndexOf('. '),
  )
  return (lastBreak > maxChars * 0.6 ? sliced.slice(0, lastBreak + 1) : sliced).trimEnd() + '…'
}
