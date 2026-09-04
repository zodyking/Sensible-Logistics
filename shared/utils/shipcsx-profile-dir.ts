import { resolve } from 'node:path'

/** Last-resort profile path. The app user can write `/tmp` in the Docker image. */
export const SHIPCSX_TMP_PROFILE_DIR = '/tmp/shipcsx-profile'

/** Docker WORKDIR is `/app` and is root-owned — never mkdir here. */
export function isUnwritableAppProfileDir(dir: string, cwd = process.cwd()): boolean {
  const normalized = resolve(dir)
  if (normalized === '/app' || normalized.startsWith('/app/')) return true
  const root = resolve(cwd)
  return normalized === resolve(root, '.data') || normalized.startsWith(`${resolve(root, '.data')}/`)
}

export const SHIPCSX_CHROMIUM_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
] as const

/**
 * Resolve the Playwright persistent-profile directory.
 * Prefer an explicit env path, then `$HOME/shipcsx-profile` (HOME is `/tmp`
 * in the runner image), then `/tmp/shipcsx-profile`. Never default to
 * `$cwd/.data` — `/app` is not writable for the `nuxt` user.
 */
export function resolveShipcsxProfileDir(options: {
  configured?: string | null
  home?: string | null
  cwd?: string | null
} = {}): string {
  const cwd = options.cwd ?? process.cwd()
  const configured = options.configured?.trim()
  if (configured) {
    const absolute = configured.startsWith('/')
      ? configured
      : resolve(cwd, configured)
    if (!isUnwritableAppProfileDir(absolute, cwd)) return absolute
  }
  const home = (options.home ?? process.env.HOME ?? '').trim()
  if (home && home !== '/') {
    const underHome = resolve(home, 'shipcsx-profile')
    if (!isUnwritableAppProfileDir(underHome, cwd)) return underHome
  }
  return SHIPCSX_TMP_PROFILE_DIR
}

/** Ordered unique candidates when the preferred directory is not writable. */
export function shipcsxProfileDirFallbacks(primary: string, home?: string | null): string[] {
  const homeDir = (home ?? '').trim()
  const extras = [
    homeDir && homeDir !== '/' ? resolve(homeDir, 'shipcsx-profile') : '',
    SHIPCSX_TMP_PROFILE_DIR,
  ].filter(Boolean)
  return [...new Set([primary, ...extras])].filter(dir => !isUnwritableAppProfileDir(dir))
}
