import { verifyApiKey } from '../../../utils/apiKeyManager'
import { getUserById } from '../../../utils/userManager'
import { limitIntegrationRequests } from '../../../utils/integrationManager'

/**
 * Authenticate the DSH bridge with a MiraZero **user API key** — the same key
 * the Integrations page creates for "connect an Agent platform".
 *
 * The key is checked through the same verifier as `/api/integrations/v1`, so a
 * revoked key stops the bridge immediately and no site-wide secret is needed.
 */
export const requireDshUser = async (event: any) => {
  const authorization = String(getHeader(event, 'authorization') || '')
  const bearer = /^Bearer\s+([^\s]+)$/i.exec(authorization)?.[1] || ''
  const token = bearer || String(getHeader(event, 'x-api-key') || '').trim()
  const key = token.length <= 4096 ? verifyApiKey(token) : null
  if (!key) {
    throw createError({ statusCode: 401, statusMessage: 'A valid MiraZero user API key is required' })
  }
  const user = await getUserById(key.userId)
  if (!user || user.status !== 'active' || user.banApiRequests) {
    throw createError({ statusCode: 403, statusMessage: 'This account cannot use the DSH bridge API' })
  }
  limitIntegrationRequests(`dsh:${user.id}`, 120)
  setHeader(event, 'Cache-Control', 'no-store')
  return user
}

export const ownsRequest = (user: any, request: any) => {
  if (!request) return false
  return user.role === 'admin' || request.ownerId === user.id
}
