import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({

  modules: [
    '@nuxt/eslint',
    'nuxt-auth-utils',
    '@vite-pwa/nuxt',
  ],

  devtools: { enabled: true },

  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content' },
        { name: 'theme-color', content: '#0C1E30' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      ],
      link: [
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' },
        { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@500;600&display=swap',
        },
      ],
    },
  },

  css: ['~/assets/css/main.css', 'leaflet/dist/leaflet.css'],

  runtimeConfig: {
    databaseUrl: '',
    databaseSsl: '',
    /**
     * Single-company deployment identity. The invite code is the shared secret
     * that lets a driver join at signup, so it is deliberately operator-owned
     * (env) rather than editable in the app.
     */
    company: {
      inviteCode: '',
      name: '',
      legalName: '',
      usdotNumber: '',
      timezone: 'America/New_York',
      cycleType: 'SEVENTY_EIGHT',
    },
    /** Absolute origin used to build email links. Never the Host header. */
    appUrl: '',
    /** Outbound SMTP. Credentials live only here — never in the database. */
    smtp: {
      host: '',
      /**
       * 465 is implicit TLS; anything else (587, 25) upgrades with STARTTLS.
       * Left empty so the service can fall back to `SMTP_PORT` — a default here
       * would always win over the unprefixed alias. Defaults to 587 in code.
       */
      port: '',
      user: '',
      password: '',
      /** Complete From header, e.g. `"Sensible Logistics" <no-reply@example.com>`. */
      from: '',
      /** From address, when not using the full `from` header. Defaults to `user`. */
      fromEmail: '',
      /** Optional display name, e.g. Sensible Logistics. */
      fromName: '',
    },
    ocrServiceUrl: '',
    ocrDetModel: '',
    ocrRecModel: '',
    s3Endpoint: '',
    s3Region: 'us-east-1',
    s3Bucket: '',
    s3AccessKeyId: '',
    s3SecretAccessKey: '',
    public: {
      appName: 'Gantry',
      mapTilesUrl: '',
      mapSatelliteUrl: '',
      geocoderUrl: '',
      /**
       * Baked when the image is built, so More shows which bundle a phone is
       * actually running. A stale service worker is otherwise invisible.
       */
      buildTime: new Date().toISOString(),
    },
  },

  future: {
    compatibilityVersion: 4,
  },
  compatibilityDate: '2025-11-01',

  nitro: {
    preset: 'node-server',
    // Camera JPEGs are sent as data URLs (~1.3× the binary). 1 MB drops them.
    maxRequestBodySize: 20 * 1024 * 1024,
  },

  vite: {
    plugins: [tailwindcss()],
  },

  typescript: {
    strict: true,
  },

  eslint: {
    config: {
      stylistic: true,
    },
  },

  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      // Baked in at build time — the manifest is a static file, so changing the
      // env var afterwards requires a rebuild.
      name: process.env.NUXT_PUBLIC_APP_NAME || 'Gantry',
      short_name: process.env.NUXT_PUBLIC_PWA_SHORT_NAME || 'Gantry',
      description: process.env.NUXT_PUBLIC_PWA_DESCRIPTION || 'Gantry — driver and yard operations',
      theme_color: '#0C1E30',
      background_color: '#EDF0F2',
      display: 'standalone',
      orientation: 'portrait',
      start_url: '/',
      scope: '/',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    workbox: {
      // Operational API writes are never cached — the Phase 2 Dexie outbox owns replay.
      navigateFallback: undefined,
      globPatterns: ['**/*.{js,css,html,svg,png,jpg,ico,woff2}'],
      navigateFallbackDenylist: [/^\/api\//],
    },
    client: {
      installPrompt: true,
    },
    devOptions: {
      enabled: false,
    },
  },
})
