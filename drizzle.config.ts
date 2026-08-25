import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/database/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://tracker:tracker@localhost:5432/container_tracker',
  },
  // PostGIS installs hundreds of objects into the target schema. Restrict
  // introspection so drizzle-kit never tries to diff or drop them.
  schemaFilter: ['public'],
  extensionsFilters: ['postgis'],
  verbose: true,
  strict: true,
})
