import { appBaseUrl } from '../mail'
import { resolveEmailLogoPath } from './logo'

export interface EmailBrand {
  appName: string
  companyName: string
  appUrl: string
  /** Public URL fallback when a CID attachment is not available. */
  logoUrl: string
  /** Filesystem path for an inline CID image. */
  logoPath: string | null
}

/**
 * Branding for transactional mail. Company name falls back to the public app
 * name so a generic env default does not appear in customer-facing copy.
 */
export function readEmailBrand(): EmailBrand {
  const config = useRuntimeConfig()
  const appName = String(config.public.appName || 'Sensible Logistics Solutions LLC').trim()
  const rawCompany = String(config.company?.name || '').trim()
  const companyName = !rawCompany || rawCompany === 'Container Tracker' ? appName : rawCompany

  let appUrl = ''
  try {
    appUrl = appBaseUrl()
  }
  catch {
    // NUXT_APP_URL unset — CID logo still works; hosted fallback does not.
  }

  return {
    appName,
    companyName,
    appUrl,
    logoUrl: appUrl ? `${appUrl}/brand/logo.png` : '',
    logoPath: resolveEmailLogoPath(),
  }
}
