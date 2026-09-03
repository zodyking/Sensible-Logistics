import { resolveProductName } from '../../shared/utils/brand'

/** Same sanitizer for API/mail, which do not run the client Nuxt plugin. */
export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()
  config.public.appName = resolveProductName(config.public.appName)
})
