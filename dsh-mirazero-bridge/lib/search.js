/**
 * Automatic retrieval through the host's `ctx.web` service.
 *
 * This is the only network capability the character can benefit from, and the
 * bridge invokes it before generation — never the model. There is no fetch path
 * here: a request can ask for a search, it cannot ask for a URL.
 */
import { makeSearchQuery, shouldSearch, fence } from './guard.js'
import { describeError, oneLine } from './util.js'

export async function maybeSearch(options) {
  const { ctx, text, config, boundary, logger } = options
  const mode = config.search?.mode ?? 'auto'
  if (!config.features?.autoSearch || mode === 'off') {
    return { ok: false, skipped: true, reason: 'search disabled' }
  }
  if (!shouldSearch(mode, text)) {
    return { ok: false, skipped: true, reason: 'no search intent' }
  }
  const query = makeSearchQuery(text)
  if (query.length < 2) {
    return { ok: false, skipped: true, reason: 'empty query' }
  }

  const web = safeGet(ctx, 'web')
  if (!web || typeof web.search !== 'function') {
    return { ok: false, skipped: true, reason: 'host has no web service' }
  }

  try {
    const signal = AbortSignal.timeout(config.search?.timeoutMs ?? 20000)
    const result = await web.search(
      { query, maxResults: config.search?.maxResults ?? 5 },
      signal,
    )
    const sources = Array.isArray(result?.sources) ? result.sources : []
    if (sources.length === 0) {
      return { ok: false, query, reason: 'no sources' }
    }
    const lines = sources.map((source, index) => {
      const title = oneLine(source.title || '(untitled)', 120)
      const url = typeof source.url === 'string' ? source.url : ''
      const snippet = oneLine(source.snippet || '', 260)
      const date = source.publishedAt ? ` (${oneLine(source.publishedAt, 40)})` : ''
      return `${index + 1}. ${title}${date}\n   ${url}${snippet ? `\n   ${snippet}` : ''}`
    })
    return {
      ok: true,
      query,
      count: sources.length,
      sources: sources.map((s) => ({ title: oneLine(s.title || '', 120), url: typeof s.url === 'string' ? s.url : '' })),
      block: fence(lines.join('\n'), boundary, 'web_search_results'),
    }
  } catch (error) {
    logger?.warn?.(`search failed: ${describeError(error)}`)
    return { ok: false, query, reason: describeError(error) }
  }
}

function safeGet(ctx, name) {
  try {
    return typeof ctx.get === 'function' ? ctx.get(name) : undefined
  } catch {
    return undefined
  }
}
