import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  ignores: [
    'Agent-Files/**',
    'drizzle/**',
    '.output/**',
    '.nuxt/**',
    'node_modules/**',
  ],
}, {
  rules: {
    'vue/multi-word-component-names': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
  },
})
