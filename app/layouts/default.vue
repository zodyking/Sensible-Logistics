<script setup lang="ts">
/**
 * Driver operational shell — fixed brand bar, single-column content column
 * capped at 520px, and a bottom tab bar sized for one-handed outdoor use.
 */
const route = useRoute()
const { user } = useUserSession()
const { appName } = useRuntimeConfig().public

const pendingSync = useState('pending-sync', () => 0)

const tabs = [
  { to: '/', label: 'Home', icon: '⌂', match: (p: string) => p === '/' },
  { to: '/pickups', label: 'Pickups', icon: '⇄', match: (p: string) => p.startsWith('/pickups') || p.startsWith('/trips') },
  { to: '/scan', label: 'Scan', icon: '⊙', match: (p: string) => p.startsWith('/scan'), fab: true },
  { to: '/containers', label: 'Containers', icon: '▦', match: (p: string) => p.startsWith('/containers') || p.startsWith('/locations') },
  { to: '/timecard', label: 'Timecard', icon: '◷', match: (p: string) => p.startsWith('/timecard') },
  { to: '/more', label: 'More', icon: '≡', match: (p: string) => p.startsWith('/more') },
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
      <div class="topbar-slot">
        <span
          class="sync-pill"
          role="status"
        >
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
        </span>
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
        :class="{ 'on': tab.match(route.path), 'tab-scan': tab.fab }"
        :aria-current="tab.match(route.path) ? 'page' : undefined"
      >
        <span
          v-if="tab.fab"
          class="scan-fab"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
          >
            <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
            <path d="M4 12h16" />
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
