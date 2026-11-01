import { getPendingRequests } from '../../../utils/requestManager'
import { requireDshUser } from './_auth'

/**
 * Full pending-request payloads for the DSH bridge.
 * Scoped to the API key's user (admin sees all), mirroring the ownership rule
 * of `/api/internal/requests`.
 */
export default defineEventHandler(async (event) => {
  const user = await requireDshUser(event)
  const query = getQuery(event)
  const limit = Math.min(20, Math.max(1, Number(query.limit || 10)))

  return {
    ok: true,
    requests: getPendingRequests(user.role === 'admin' ? undefined : user.id)
      .slice(0, limit)
      .map(request => ({
        id: request.id,
        type: request.type,
        requestKind: request.requestKind || 'chat',
        titleSuggestion: request.titleSuggestion || '',
        llmId: request.llmId || '',
        llmName: request.llmName || '',
        ownerId: request.ownerId || '',
        callerUserId: request.callerUserId || '',
        requesterLabel: request.requesterLabel || '',
        timestamp: request.timestamp,
        payload: request.payload,
        history: request.history || [],
        responseMessages: request.responseMessages || []
      }))
  }
})
