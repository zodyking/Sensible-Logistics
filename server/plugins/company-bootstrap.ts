/**
 * Provisions the deployment's company from environment variables at startup and
 * applies a rotated invite code, so a fresh database is usable on first boot.
 *
 * Failures are logged rather than thrown: the server must still start when the
 * database is briefly unavailable, and signup re-runs this on demand.
 */
export default defineNitroPlugin(async () => {
  try {
    const company = await ensurePrimaryCompany(useDb())
    console.info(`[company] "${company.name}" ready — driver signup accepts the configured invite code.`)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[company] bootstrap skipped: ${message}`)
  }
})
