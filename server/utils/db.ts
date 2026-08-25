import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from '../database/schema'

export { schema }

let pool: pg.Pool | undefined
let db: NodePgDatabase<typeof schema> | undefined

/**
 * Lazily-created connection pool. Nitro keeps the module alive for the process
 * lifetime, so a single pool is shared across requests.
 */
export function useDb(): NodePgDatabase<typeof schema> {
  if (db) return db

  const config = useRuntimeConfig()
  const connectionString = config.databaseUrl || process.env.DATABASE_URL

  if (!connectionString) {
    throw createError({
      statusCode: 500,
      statusMessage: 'DATABASE_URL is not configured.',
    })
  }

  const useSsl = (config.databaseSsl || process.env.NUXT_DATABASE_SSL) === 'true'

  pool = new pg.Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })

  pool.on('error', (error) => {
    console.error('[db] idle client error', error)
  })

  db = drizzle(pool, { schema })
  return db
}

export type Database = NodePgDatabase<typeof schema>
/** Transaction handle passed to service functions that must be atomic. */
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
export type DbExecutor = Database | DbTransaction
