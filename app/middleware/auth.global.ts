/**
 * Route guard.
 *
 * This is a usability layer only — every API route independently enforces role
 * and tenant rules server-side (spec 21).
 *
 * Admins have no dashboard: signing in takes them straight to a management
 * page, and `/` is redirected away from the driver operational home (spec 3).
 */
const PUBLIC_ROUTES = new Set(['/login', '/signup', '/verify-email'])

export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn, user } = useUserSession()

  if (PUBLIC_ROUTES.has(to.path)) {
    if (loggedIn.value) {
      return navigateTo(user.value?.role === 'ADMIN' ? '/admin/containers' : '/')
    }
    return
  }

  if (!loggedIn.value) {
    return navigateTo({ path: '/login', query: to.fullPath === '/' ? undefined : { redirect: to.fullPath } })
  }

  const isAdminRoute = to.path.startsWith('/admin')

  if (isAdminRoute && user.value?.role !== 'ADMIN') {
    return navigateTo('/')
  }

  if (!isAdminRoute && user.value?.role === 'ADMIN') {
    return navigateTo('/admin/containers')
  }
})
