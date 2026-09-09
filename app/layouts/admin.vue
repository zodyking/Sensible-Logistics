<script setup lang="ts">
/**
 * Admin / dispatcher shell — persistent left nav on desktop, drawer on mobile.
 * Dispatch is the home: a map-first board, then the management records.
 */
import { roleLabel } from '#shared/utils/domain'

const route = useRoute()
const { user, clear } = useUserSession()
const { appName } = useRuntimeConfig().public
const drawerOpen = ref(false)

const nav: Array<{
  section: string
  items: Array<{ to: string, label: string, icon: string, exact?: boolean }>
}> = [
  {
    section: 'Operations',
    items: [
      { to: '/admin', label: 'Board', icon: '◎', exact: true },
      { to: '/admin/dispatch', label: 'Dispatch', icon: '☑' },
      { to: '/admin/inventory', label: 'Inventory', icon: '▦' },
      { to: '/admin/drivers', label: 'Drivers', icon: '☰' },
    ],
  },
  {
    section: 'Account',
    items: [
      { to: '/admin/account', label: 'Account', icon: '⚙' },
      { to: '/admin/settings', label: 'Company', icon: '▤' },
      { to: '/more', label: 'More', icon: '⋯' },
    ],
  },
]

function navActive(to: string, exact?: boolean) {
  return exact ? route.path === to : route.path.startsWith(to)
}

const heading = computed(() => {
  if (route.path.startsWith('/admin/inventory')) return 'Inventory'
  if (route.path.startsWith('/containers')) return 'Containers'
  if (route.path.startsWith('/chassis')) return 'Chassis'
  if (route.path.startsWith('/locations')) return 'Locations'
  for (const group of nav) {
    const hit = group.items.find(item => navActive(item.to, item.exact))
    if (hit) return hit.label
  }
  return 'Dispatch'
})

watch(() => route.fullPath, () => {
  drawerOpen.value = false
})

async function signOut() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await clear()
  await navigateTo('/login')
}
</script>

<template>
  <div class="a-shell">
    <nav
      class="a-nav a-nav-fixed"
      aria-label="Dispatcher navigation"
    >
      <div class="brand !items-start px-3 pb-4">
        <b>{{ appName }}</b>
        <i
          class="brand-rule"
          aria-hidden="true"
        />
      </div>
      <template
        v-for="group in nav"
        :key="group.section"
      >
        <div class="a-nav-section">
          {{ group.section }}
        </div>
        <NuxtLink
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          :class="{ on: navActive(item.to, item.exact) }"
          :aria-current="navActive(item.to, item.exact) ? 'page' : undefined"
        >
          <span
            class="n-ico"
            aria-hidden="true"
          >{{ item.icon }}</span>
          {{ item.label }}
        </NuxtLink>
      </template>
    </nav>

    <div class="a-body">
      <header class="a-topbar">
        <button
          class="a-menu-btn min-h-11 px-2 text-lg"
          aria-label="Open navigation"
          @click="drawerOpen = true"
        >
          ≡
        </button>
        <strong class="font-[family-name:var(--font-display)] text-sm tracking-wide">{{ heading }}</strong>
        <div class="ml-auto flex items-center gap-3">
          <span class="hidden text-xs text-white/70 sm:inline">{{ user?.fullName }} · {{ roleLabel(user?.role) }}</span>
          <button
            class="min-h-11 rounded-[var(--radius-sm)] bg-white/10 px-3 text-xs font-semibold"
            @click="signOut"
          >
            Sign out
          </button>
        </div>
      </header>

      <main
        class="a-main"
        :class="{ 'a-main-flush': route.path === '/admin' }"
      >
        <slot />
      </main>
    </div>

    <div
      v-if="drawerOpen"
      class="a-drawer"
      @click.self="drawerOpen = false"
    >
      <nav
        class="a-nav"
        aria-label="Dispatcher navigation"
      >
        <div class="brand !items-start px-3 pb-4">
          <b>{{ appName }}</b>
          <i
            class="brand-rule"
            aria-hidden="true"
          />
        </div>
        <template
          v-for="group in nav"
          :key="group.section"
        >
          <div class="a-nav-section">
            {{ group.section }}
          </div>
          <NuxtLink
            v-for="item in group.items"
            :key="item.to"
            :to="item.to"
            :class="{ on: navActive(item.to, item.exact) }"
          >
            <span
              class="n-ico"
              aria-hidden="true"
            >{{ item.icon }}</span>
            {{ item.label }}
          </NuxtLink>
        </template>
      </nav>
    </div>
  </div>
</template>
