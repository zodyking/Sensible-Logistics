import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/database/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://tracker:tracker@localhost:5432/container_tracker',
  },
  schemaFilter: ['public'],
  verbose: true,
  strict: true,
})
