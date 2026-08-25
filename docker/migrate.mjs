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

async function main() {
  try {
    await connectWithRetry()

    log(`Running migrations from ${migrationsFolder}`)
    await migrate(db, { migrationsFolder })
    log('Migrations completed successfully.')

    await pool.end()
    process.exit(0)
  }
  catch (error) {
    const reason = error instanceof Error ? error.stack || error.message : String(error)
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
