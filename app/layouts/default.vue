<script setup lang="ts">
/**
 * Driver operational shell — sticky brand bar, 520px column, five-tab bar
 * locked to the bottom of the viewport: Home, Trips, Tasks (FAB), Containers, More.
 */
const route = useRoute()
const { user } = useUserSession()
const { appName } = useRuntimeConfig().public

const pendingSync = useState('pending-sync', () => 0)

const tabs: Array<{
  to: string
  label: string
  match: (p: string) => boolean
  fab?: boolean
  icon?: 'home' | 'trips' | 'containers' | 'more' | 'tasks'
}> = [
  { to: '/', label: 'Home', icon: 'home', match: p => p === '/' },
  { to: '/pickups', label: 'Trips', icon: 'trips', match: p => p.startsWith('/pickups') || p.startsWith('/trips') },
  { to: '/tasks', label: 'Tasks', fab: true, match: p => p.startsWith('/tasks') || p.startsWith('/timecard') },
  { to: '/containers', label: 'Containers', icon: 'containers', match: p => p.startsWith('/containers') || (/^\/locations\/[^/]+/.test(p) && !p.startsWith('/locations/new')) },
  { to: '/more', label: 'More', icon: 'more', match: p => p.startsWith('/more') || p.startsWith('/scan') || p === '/locations' || p.startsWith('/locations/new') || p === '/settings' || p.startsWith('/documents') || p.startsWith('/connections') || p.startsWith('/reset') },
]
</script>

<template>
  <div class="d-app">
    <header class="d-topbar">
      <div class="brand">
        <b>{{ user?.companyName ?? appName }}</b>
        <i
          class="brand-rule"
          aria-hidden="true"
        />
      </div>
      <div class="sync-pill">
        <span
          class="sync-dot"
          :class="{ idle: pendingSync === 0 }"
          aria-hidden="true"
        />
        <template v-if="pendingSync > 0">
          {{ pendingSync }}<span class="sync-lbl"> pending sync</span>
        </template>
        <template v-else>
          <span class="sync-lbl">Synced</span>
          <span class="sr-only">All work is synced</span>
        </template>
      </div>
    </header>

    <div class="d-shell">
      <slot />
    </div>

    <nav
      class="tabbar"
      aria-label="Driver navigation"
    >
      <NuxtLink
        v-for="tab in tabs"
        :key="tab.to"
        :to="tab.to"
        class="tab"
        :class="{ 'on': tab.match(route.path), 'tab-time': tab.fab }"
        :aria-current="tab.match(route.path) ? 'page' : undefined"
      >
        <span
          v-if="tab.fab"
          class="time-fab"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            width="26"
            height="26"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M9.4 6.4h10.2" />
            <path d="M9.4 12h10.2" />
            <path d="M9.4 17.6h10.2" />
            <path d="M4.4 6.4l1.35 1.35 2.3-2.7" />
            <path d="M4.4 12l1.35 1.35 2.3-2.7" />
            <path d="M4.4 17.6l1.35 1.35 2.3-2.7" />
          </svg>
        </span>
        <span
          v-else
          class="t-ico"
          aria-hidden="true"
        >
          <TabIcon
            v-if="tab.icon"
            :name="tab.icon"
          />
        </span>
        {{ tab.label }}
      </NuxtLink>
    </nav>
  </div>
</template>
