import { getPendingRequests } from '../../../utils/requestManager'
import { requireDshUser } from './_auth'

export default defineEventHandler(async (event) => {
  const user = await requireDshUser(event)
  const pending = getPendingRequests(user.role === 'admin' ? undefined : user.id)
  return {
    ok: true,
    pending: pending.length,
    fullContext: true,
    userId: user.id
  }
})
