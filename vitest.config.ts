import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    alias: {
      // Matches the Nuxt alias, so app modules under test resolve shared code
      // the same way the production build does.
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
})
