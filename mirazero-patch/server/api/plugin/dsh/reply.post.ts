import { finishRequest, getPendingRequest, pushToRequest } from '../../../utils/requestManager'
import { ownsRequest, requireDshIntegration } from './_auth'

export default defineEventHandler(async (event) => {
  const auth = await requireDshIntegration(event)
  const body = await readBody(event)
  const id = String(body?.id || '').trim()
  const response = String(body?.response || '')
  const finish = body?.finish !== false

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Request id is required' })
  }
  if (!response.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Response is required' })
  }
  const pending = getPendingRequest(id)
  if (!ownsRequest(auth, pending)) {
    throw createError({ statusCode: 404, statusMessage: 'Request not found' })
  }

  if (finish) {
    await finishRequest(id, { content: response, simulateStream: false })
  } else {
    await pushToRequest(id, { content: response, simulateStream: false })
  }
  return { success: true, finished: finish }
})
