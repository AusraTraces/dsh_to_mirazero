import { getPendingRequests } from '../../../utils/requestManager'
import { requestBelongsTo, requireDshIntegration } from './_auth'

/**
 * Full pending-request payloads for the DSH bridge, scoped to the single model
 * bound to the integration key.
 */
export default defineEventHandler(async (event) => {
  const auth = await requireDshIntegration(event)
  const query = getQuery(event)
  const limit = Math.min(20, Math.max(1, Number(query.limit || 10)))

  return {
    ok: true,
    model: { id: auth.model.id, name: auth.model.name },
    requests: getPendingRequests(auth.user.role === 'admin' ? undefined : auth.user.id)
      .filter(request => requestBelongsTo(auth, request))
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
