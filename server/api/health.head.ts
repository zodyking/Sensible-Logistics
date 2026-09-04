/**
 * Docker / Dokploy `wget --spider` sends HEAD. Without this route the probe
 * falls through to the Vue app and logs "No match found for /api/health".
 */
export default defineEventHandler((event) => {
  return sendNoContent(event, 200)
})
