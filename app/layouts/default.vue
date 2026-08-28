<script setup lang="ts">
/**
 * Driver operational shell — fixed brand bar, 520px column, five-tab bar
 * matching Agent-Files/design-template.html: Home, Trips, Time (FAB), Containers, More.
 */
const route = useRoute()
const { user } = useUserSession()
const { appName } = useRuntimeConfig().public

const pendingSync = useState('pending-sync', () => 0)

const tabs = [
  { to: '/', label: 'Home', icon: '⌂', match: (p: string) => p === '/' },
  { to: '/pickups', label: 'Trips', icon: '⇄', match: (p: string) => p.startsWith('/pickups') || p.startsWith('/trips') },
  { to: '/timecard', label: 'Time', icon: 'time', match: (p: string) => p.startsWith('/timecard'), fab: true },
  { to: '/containers', label: 'Containers', icon: '▦', match: (p: string) => p.startsWith('/containers') || (/^\/locations\/[^/]+/.test(p) && !p.startsWith('/locations/new')) },
  { to: '/more', label: 'More', icon: '≡', match: (p: string) => p.startsWith('/more') || p.startsWith('/scan') || p === '/locations' || p.startsWith('/locations/new') },
]
</script>

<template>
  <div>
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
          >
            <circle
              cx="12"
              cy="12"
              r="8.5"
            />
            <path d="M12 7.8v4.4l3 1.8" />
          </svg>
        </span>
        <span
          v-else
          class="t-ico"
          aria-hidden="true"
        >{{ tab.icon }}</span>
        {{ tab.label }}
      </NuxtLink>
    </nav>
  </div>
</template>
