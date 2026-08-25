<script setup lang="ts">
useHead({ title: 'More' })

const { user, clear } = useUserSession()
const { appName } = useRuntimeConfig().public

const signingOut = ref(false)

async function signOut() {
  signingOut.value = true
  await $fetch('/api/auth/logout', { method: 'POST' })
  await clear()
  await navigateTo('/login', { replace: true })
}

const links = [
  { to: '/locations', glyph: '◫', label: 'Locations', hint: 'Yards, terminals, customers' },
  { to: '/timecard', glyph: '◷', label: 'Timecard', hint: 'Punches and DOT time record' },
  { to: '/containers?scope=all', glyph: '▣', label: 'Full container history', hint: 'Including released containers' },
]
</script>

<template>
  <section class="d-page">
    <PageHeader
      eyebrow="Account"
      title="More"
    />

    <div class="card mb-5 p-4">
      <div class="flex items-center gap-3">
        <span
          class="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--color-navy-800)] font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--color-amber-500)]"
          aria-hidden="true"
        >
          {{ (user?.firstName?.[0] ?? '') + (user?.lastName?.[0] ?? '') }}
        </span>
        <div class="min-w-0">
          <b class="block font-[family-name:var(--font-display)] text-lg font-semibold">{{ user?.fullName }}</b>
          <small class="text-xs text-[var(--color-ink-500)]">{{ user?.email }} · {{ user?.companyName }}</small>
        </div>
      </div>
    </div>

    <div class="card rowlist">
      <NuxtLink
        v-for="link in links"
        :key="link.to"
        :to="link.to"
        class="row"
      >
        <span
          class="row-ico"
          aria-hidden="true"
        >{{ link.glyph }}</span>
        <span class="row-main">
          <b>{{ link.label }}</b>
          <small>{{ link.hint }}</small>
        </span>
        <span
          class="row-end"
          aria-hidden="true"
        >›</span>
      </NuxtLink>
    </div>

    <div class="section-label">
      <span>Sync</span>
    </div>

    <div class="card p-4">
      <p class="text-sm">
        <b>Offline queue — Phase 2.</b>
        Work you record is written straight to the server today. The durable IndexedDB queue that
        keeps pickups and drop-offs working through dead zones ships next.
      </p>
    </div>

    <button
      class="btn-ghost mt-5"
      :disabled="signingOut"
      @click="signOut"
    >
      {{ signingOut ? 'Signing out…' : 'Sign out' }}
    </button>

    <p class="mt-6 text-center text-xs text-[var(--color-ink-400)]">
      {{ appName }} · Phase 1
    </p>
  </section>
</template>
