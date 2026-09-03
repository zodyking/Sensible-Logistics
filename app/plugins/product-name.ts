import { resolveProductName } from '#shared/utils/brand'

/** Keep the brand bar and titles on Yard Manager even if deploy env is stale. */
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  config.public.appName = resolveProductName(config.public.appName)
})
