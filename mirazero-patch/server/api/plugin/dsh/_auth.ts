import { verifyIntegrationKey } from '../../../utils/integrationKeyManager'
import { getUserById } from '../../../utils/userManager'
import { getLlms } from '../../../utils/llmManager'
import { limitIntegrationRequests } from '../../../utils/integrationManager'

/**
 * Authenticate the DSH bridge with a **dedicated integration key** created in
 * the current MiraZero model settings (`mzi_...`). The key is bound to one
 * owned model, exactly like `/api/integrations/v1`, so the bridge can only see
 * and answer that model's requests.
 */
export const requireDshIntegration = async (event: any) => {
  const authorization = String(getHeader(event, 'authorization') || '')
  const bearer = /^Bearer\s+([^\s]+)$/i.exec(authorization)?.[1] || ''
  const token = bearer || String(getHeader(event, 'x-api-key') || '').trim()
  const key = token.length <= 4096 ? verifyIntegrationKey(token) : null
  if (!key) {
    throw createError({ statusCode: 401, statusMessage: 'A valid MiraZero integration key is required' })
  }
  const user = await getUserById(key.userId)
  if (!user || user.status !== 'active' || user.banApiRequests) {
    throw createError({ statusCode: 403, statusMessage: 'This account cannot use the DSH bridge API' })
  }
  const model = getLlms().find(model => model.id === key.modelId && model.ownerId === user.id && model.status === 'online')
  if (!model) {
    throw createError({ statusCode: 403, statusMessage: 'The model bound to this integration key is unavailable' })
  }
  limitIntegrationRequests(`dsh:${user.id}`, 120)
  setHeader(event, 'Cache-Control', 'no-store')
  return { user, key, model }
}

export const requestBelongsTo = (auth: any, request: any) => {
  if (!request) return false
  const sameModel = request.llmId
    ? request.llmId === auth.model.id
    : request.llmName === auth.model.name
  if (!sameModel) return false
  return auth.user.role === 'admin' || request.ownerId === auth.user.id
}

export const ownsRequest = (auth: any, request: any) => requestBelongsTo(auth, request)
