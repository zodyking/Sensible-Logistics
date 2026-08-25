import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

const { Pool } = pg

const MAX_ATTEMPTS = 20
const BACKOFF_MS = 3000

function log(message) {
  console.log(`[migrate] ${message}`)
}

function logError(message) {
  console.error(`[migrate] ${message}`)
}

/** Operator-fixable misconfiguration: the guidance above it is the useful part, not a stack. */
class ConfigurationError extends Error {}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  logError('DATABASE_URL is not set. Refusing to run migrations.')
  process.exit(1)
}

const sslEnabled
  = process.env.DATABASE_SSL === 'true' || process.env.NUXT_DATABASE_SSL === 'true'

const pool = new Pool({
  connectionString: databaseUrl,
  ...(sslEnabled ? { ssl: { rejectUnauthorized: false } } : {}),
})

const db = drizzle(pool)
const migrationsFolder = fileURLToPath(new URL('./drizzle', import.meta.url))

async function connectWithRetry() {
  let lastError
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    log(`Connecting to database (attempt ${attempt}/${MAX_ATTEMPTS})...`)
    try {
      await pool.query('SELECT 1')
      log('Database connection established.')
      return
    }
    catch (error) {
      lastError = error
      const reason = error instanceof Error ? error.message : String(error)
      logError(`Connection attempt ${attempt}/${MAX_ATTEMPTS} failed: ${reason}`)
      if (attempt < MAX_ATTEMPTS) {
        log(`Retrying in ${BACKOFF_MS / 1000}s...`)
        await new Promise((resolve) => {
          setTimeout(resolve, BACKOFF_MS)
        })
      }
    }
  }
  throw lastError
}

async function postgisInstalled() {
  try {
    const { rows } = await pool.query('SELECT 1 FROM pg_extension WHERE extname = \'postgis\';')
    return rows.length > 0
  }
  catch {
    return false
  }
}

/**
 * The schema declares `geometry(Point,4326)` / `geometry(Polygon,4326)` columns,
 * so PostGIS is a hard requirement rather than an optimisation. Install it here
 * — outside the migration transaction — because a failed `CREATE EXTENSION`
 * inside that transaction aborts every statement that follows it.
 */
async function ensurePostgis() {
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS postgis;')
    log('PostGIS extension is available.')
    return
  }
  catch (error) {
    const reason = error instanceof Error ? error.message : String(error)

    // A restricted role may be unable to run CREATE EXTENSION even though the
    // extension is already installed, which is fine.
    if (await postgisInstalled()) {
      log(`PostGIS is already installed (CREATE EXTENSION was rejected: ${reason}).`)
      return
    }

    logError(`PostGIS is not installed and could not be created: ${reason}`)
    logError('This schema stores geometry columns, so plain PostgreSQL cannot host it. Either:')
    logError('  1. leave DATABASE_URL unset so the app uses the bundled `postgres` service '
      + '(postgis/postgis:17-3.5) from docker-compose.yml, or')
    logError('  2. point DATABASE_URL at a PostGIS-enabled server and, if the app role is not '
      + 'a superuser, run `CREATE EXTENSION postgis;` on that database once as an admin.')
    throw new ConfigurationError('PostGIS extension unavailable', { cause: error })
  }
}

async function main() {
  try {
    await connectWithRetry()
    await ensurePostgis()

    log(`Running migrations from ${migrationsFolder}`)
    await migrate(db, { migrationsFolder })
    log('Migrations completed successfully.')

    await pool.end()
    process.exit(0)
  }
  catch (error) {
    let reason
    if (error instanceof ConfigurationError) reason = error.message
    else if (error instanceof Error) reason = error.stack || error.message
    else reason = String(error)
    logError(`Migration failed: ${reason}`)
    try {
      await pool.end()
    }
    catch {
      // ignore pool teardown errors after a failed migrate
    }
    process.exit(1)
  }
}

await main()
