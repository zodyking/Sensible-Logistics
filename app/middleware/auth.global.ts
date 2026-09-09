/**
 * Route guard.
 *
 * This is a usability layer only — every API route independently enforces role
 * and tenant rules server-side (spec 21).
 *
 * Dispatchers (ADMIN) land on the map board. `/` stays the driver operational
 * home, so signed-in admins are redirected away from it.
 */
import { roleHomePath } from '#shared/utils/domain'

const PUBLIC_ROUTES = new Set(['/login', '/signup', '/verify-email'])

export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn, user } = useUserSession()

  if (PUBLIC_ROUTES.has(to.path)) {
    if (loggedIn.value) {
      return navigateTo(roleHomePath(user.value?.role))
    }
    return
  }

  if (!loggedIn.value) {
    return navigateTo({ path: '/login', query: to.fullPath === '/' ? undefined : { redirect: to.fullPath } })
  }

  const isAdminRoute = to.path.startsWith('/admin')
  const locationPool = to.path === '/locations' || to.path.startsWith('/locations/')
  const containerRecord = to.path.startsWith('/containers')
  const moreArea = to.path === '/more' || to.path.startsWith('/connections') || to.path.startsWith('/reset')

  if (isAdminRoute && user.value?.role !== 'ADMIN') {
    return navigateTo('/')
  }

  // Location records are a shared company asset — admins create them, drivers
  // pick them. Pickup/scan remain driver-only. The More cheat-code box and
  // hidden operator pages (API connections, clear records) stay reachable
  // for admins.
  if (!isAdminRoute && user.value?.role === 'ADMIN' && !locationPool && !containerRecord && !moreArea) {
    return navigateTo(roleHomePath('ADMIN'))
  }
})
