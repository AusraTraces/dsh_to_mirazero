/**
 * Multimodal prompt assembly.
 *
 * Text keeps its structure; images are passed to `sessionController.prompt` as
 * DSH image parts (canonical base64). Remote URLs are optional and go through a
 * public-address guard: loopback, private, link-local, and DNS answers that
 * point there are refused before any request is made.
 */
import { lookup } from 'node:dns/promises'
import { describeError } from './util.js'

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export async function buildPromptParts(options) {
  const { normalized, config, logger } = options
  const parts = []
  const name = config.character.name
  const seen = new Set()
  let imageCount = 0
  let dropped = 0

  parts.push({
    type: 'text',
    text: `【MiraZero 外部对话】\n以下是公开调用方发来的对话记录。按角色设定回应最后一条。`,
  })

  for (const message of normalized.messages) {
    const speaker = message.role === 'assistant' ? name : '对方'
    const text = message.text ? `【${speaker}】\n${message.text}` : ''
    if (text) parts.push({ type: 'text', text })

    for (const image of message.images) {
      if (imageCount >= config.media.maxImages) {
        dropped += 1
        continue
      }
      const key = image.kind === 'inline' ? `i:${image.mediaType}:${image.data.length}:${image.data.slice(0, 64)}` : `r:${image.url}`
      if (seen.has(key)) continue
      seen.add(key)
      try {
        const resolved = await resolveImage(image, config, logger)
        if (!resolved) {
          dropped += 1
          continue
        }
        parts.push({
          type: 'image',
          mediaType: resolved.mediaType,
          data: resolved.data,
          ...(resolved.name ? { name: resolved.name } : {}),
        })
        imageCount += 1
      } catch (error) {
        dropped += 1
        logger?.warn?.(`image skipped: ${describeError(error)}`)
      }
    }
  }

  return { parts, imageCount, dropped }
}

export async function resolveImage(image, config, logger) {
  if (image.kind === 'inline') {
    const data = canonicalBase64(image.data)
    if (!data) return null
    if (Buffer.from(data, 'base64').byteLength > config.media.maxImageBytes) return null
    return { mediaType: image.mediaType, data, name: image.name }
  }

  if (image.kind !== 'remote') return null
  return fetchRemoteImage(image, config, logger)
}

async function fetchRemoteImage(image, config, logger) {
  let url
  try {
    url = new URL(image.url)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (await resolvesToPrivate(url.hostname)) {
    logger?.warn?.(`remote image refused (private address): ${url.hostname}`)
    return null
  }

  const response = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers: { accept: 'image/png,image/jpeg,image/webp,image/gif' },
    signal: AbortSignal.timeout(config.media.fetchTimeoutMs),
  })
  if (response.status >= 300 && response.status < 400) return null
  if (!response.ok) return null

  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > config.media.maxImageBytes) return null

  const mediaType = (response.headers.get('content-type') || '').split(';')[0].trim().toLocaleLowerCase()
  if (!IMAGE_TYPES.has(mediaType)) return null

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength === 0 || buffer.byteLength > config.media.maxImageBytes) return null
  return {
    mediaType,
    data: buffer.toString('base64'),
    name: image.name || url.pathname.split('/').pop() || 'image',
  }
}

async function resolvesToPrivate(hostname) {
  const host = hostname.toLocaleLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (isPrivateAddress(host)) return true
  try {
    const addresses = await lookup(host, { all: true })
    return addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))
  } catch {
    return true
  }
}

export function isPrivateAddress(value) {
  const address = String(value || '').toLocaleLowerCase()
  if (address === '::1' || address === '0.0.0.0' || address === '::') return true
  if (address.startsWith('::ffff:')) return isPrivateAddress(address.slice(7))
  if (address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80')) return true
  if (address.startsWith('127.')) return true
  if (address.startsWith('10.') || address.startsWith('192.168.')) return true
  if (address.startsWith('169.254.')) return true
  const cgnat = /^100\.(\d{1,3})\./.exec(address)
  if (cgnat) {
    const second = Number(cgnat[1])
    if (second >= 64 && second <= 127) return true
  }
  const match = /^172\.(\d{1,3})\./.exec(address)
  if (match) {
    const second = Number(match[1])
    if (second >= 16 && second <= 31) return true
  }
  return false
}

export function canonicalBase64(value) {
  const cleaned = String(value || '').replace(/\s+/g, '')
  if (!cleaned) return ''
  const buffer = Buffer.from(cleaned, 'base64')
  if (buffer.byteLength === 0) return ''
  return buffer.toString('base64')
}
