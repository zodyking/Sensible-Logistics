import { requireDriver } from '../../utils/session'
import { getOrCreateEndpoint, publicAppOrigin, rotateEndpointToken, setupView } from '../../services/tasks'

/** Rotate the driver's inbound webhook token. Existing Shortcuts must be updated. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const db = useDb()
  const endpoint = event.method === 'POST'
    ? await rotateEndpointToken(db, auth)
    : await getOrCreateEndpoint(db, auth)

  return { setup: setupView(endpoint, publicAppOrigin(event)) }
})
