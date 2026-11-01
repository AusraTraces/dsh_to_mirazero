/** Local diagnostic/control routes under /.dsh-mirazero-bridge. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isolationManifest } from './bridge.js'
import { describeError } from './util.js'

export const ROUTE_PREFIX = '/.dsh-mirazero-bridge'

export function registerRoutes(ctx, bridge) {
  const webServer = safeGet(ctx, 'webServer')
  if (!webServer || typeof webServer.register !== 'function') {
    bridge.logger.warn('webServer is unavailable; diagnostic routes are disabled')
    return () => {}
  }
  try {
    return webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: (req, res) => {
        void handle(req, res, bridge)
      },
    })
  } catch (error) {
    bridge.logger.warn(`route registration failed: ${describeError(error)}`)
    return () => {}
  }
}

async function handle(req, res, bridge) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = url.pathname.slice(ROUTE_PREFIX.length) || '/'
  try {
    if (req.method === 'GET' && (path === '/' || path === '/status')) {
      return json(res, 200, bridge.status())
    }
    if (req.method === 'GET' && path === '/health') {
      const status = bridge.status()
      return json(res, 200, { ok: true, configured: status.configured, running: status.running })
    }
    if (req.method === 'GET' && path === '/isolation') {
      return json(res, 200, isolationManifest())
    }
    if (req.method === 'GET' && path === '/pending') {
      const limit = Number(url.searchParams.get('limit') || 20)
      return json(res, 200, { requests: await bridge.pending(limit) })
    }
    if (req.method === 'GET' && path === '/audit') {
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 50)))
      return json(res, 200, { entries: readAudit(bridge, limit) })
    }
    if (req.method === 'GET' && path === '/models') {
      return json(res, 200, { models: await bridge.listModels() })
    }
    if (req.method === 'GET' && path === '/character') {
      return json(res, 200, { character: bridge.character(), features: bridge.features() })
    }
    if (req.method === 'POST' && path === '/character') {
      const body = await readJson(req)
      return json(res, 200, { character: bridge.setCharacter(body) })
    }
    if (req.method === 'GET' && path === '/features') {
      return json(res, 200, { features: bridge.features() })
    }
    if (req.method === 'POST' && path === '/features') {
      const body = await readJson(req)
      return json(res, 200, { features: bridge.setFeatures(body) })
    }
    if (req.method === 'POST' && path === '/start') {
      return json(res, 200, await bridge.start())
    }
    if (req.method === 'POST' && path === '/stop') {
      return json(res, 200, bridge.stop('http'))
    }
    if (req.method === 'POST' && path === '/answer') {
      const body = await readJson(req)
      return json(res, 200, await bridge.answer(body.id, body.response))
    }
    return json(res, 404, { error: `unknown route ${req.method} ${path}` })
  } catch (error) {
    return json(res, 500, { error: describeError(error) })
  }
}

function readAudit(bridge, limit) {
  const file = join(bridge.config.stateDir, 'audit.jsonl')
  try {
    const text = readFileSync(file, 'utf8')
    return text
      .trim()
      .split('\n')
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

function json(res, status, payload) {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(`${JSON.stringify(payload, null, 2)}\n`)
  } catch {
    // response already gone
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1024 * 1024) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(new Error(`body is not valid JSON: ${describeError(error)}`))
      }
    })
    req.on('error', reject)
  })
}

function safeGet(ctx, name) {
  try {
    return typeof ctx.get === 'function' ? ctx.get(name) : undefined
  } catch {
    return undefined
  }
}
