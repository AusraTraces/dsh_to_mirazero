import { getPendingRequests } from '../../../utils/requestManager'
import { requestBelongsTo, requireDshIntegration } from './_auth'

export default defineEventHandler(async (event) => {
  const auth = await requireDshIntegration(event)
  const pending = getPendingRequests(auth.user.role === 'admin' ? undefined : auth.user.id)
    .filter(request => requestBelongsTo(auth, request))
  return {
    ok: true,
    pending: pending.length,
    fullContext: true,
    userId: auth.user.id,
    modelId: auth.model.id,
    modelName: auth.model.name
  }
})
