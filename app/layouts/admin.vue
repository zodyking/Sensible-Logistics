<script setup lang="ts">
/**
 * Admin management shell — persistent left nav on desktop, drawer on mobile.
 * Denser than the driver experience and deliberately dashboard-free (spec 3).
 */
const route = useRoute()
const { user, clear } = useUserSession()
const { appName } = useRuntimeConfig().public
const drawerOpen = ref(false)

const nav = [
  {
    section: 'Operations',
    items: [
      { to: '/admin/containers', label: 'Containers', icon: '▦' },
      { to: '/admin/drivers', label: 'Drivers & timecards', icon: '☰' },
      { to: '/admin/locations', label: 'Locations & yards', icon: '◫' },
    ],
  },
  {
    section: 'Records',
    items: [
      { to: '/admin/documents', label: 'Documents', icon: '▤' },
      { to: '/admin/settings', label: 'Settings', icon: '⚙' },
      { to: '/more', label: 'More', icon: '⋯' },
    ],
  },
]

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
      aria-label="Management navigation"
    >
      <div class="brand !items-start px-3 pb-4">
        <span class="brand-lockup">
          <img
            class="brand-mark"
            src="/icons/icon-192.png"
            alt=""
          >
          <b>{{ user?.companyName ?? appName }}</b>
        </span>
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
          :class="{ on: route.path.startsWith(item.to) }"
          :aria-current="route.path.startsWith(item.to) ? 'page' : undefined"
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
        <strong class="font-[family-name:var(--font-display)] text-sm tracking-wide">Management</strong>
        <div class="ml-auto flex items-center gap-3">
          <span class="hidden text-xs text-white/70 sm:inline">{{ user?.fullName }} · Admin</span>
          <button
            class="min-h-11 rounded-[var(--radius-sm)] bg-white/10 px-3 text-xs font-semibold"
            @click="signOut"
          >
            Sign out
          </button>
        </div>
      </header>

      <main class="a-main">
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
        aria-label="Management navigation"
      >
        <div class="brand !items-start px-3 pb-4">
          <span class="brand-lockup">
            <img
              class="brand-mark"
              src="/icons/icon-192.png"
              alt=""
            >
            <b>{{ user?.companyName ?? appName }}</b>
          </span>
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
            :class="{ on: route.path.startsWith(item.to) }"
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
