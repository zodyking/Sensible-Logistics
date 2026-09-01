<script setup lang="ts">
useHead({ title: 'Locations' })

const search = ref('')
const debounced = ref('')

let debounceTimer: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounced.value = value
  }, 300)
})

const { data, status, error } = await useFetch('/api/locations', {
  query: computed(() => ({
    q: debounced.value || undefined,
    limit: 100,
    includeUncategorized: '1',
  })),
})

function addressLine(item: { addressLine1: string | null, city: string | null, isUncategorized?: boolean }) {
  if (item.isUncategorized) return 'Holding site for equipment from deleted locations'
  return [item.addressLine1, item.city].filter(Boolean).join(' · ') || '—'
}
</script>

<template>
  <section class="d-page">
    <span class="eyebrow">Inventory</span>
    <h1 class="d-title">
      Locations
    </h1>
    <div class="searchbar">
      ⌕
      <input
        v-model="search"
        type="search"
        placeholder="Search location, customer, container…"
        aria-label="Search locations"
      >
    </div>

    <NuxtLink
      to="/locations/new"
      class="btn-dark mb-4 w-full"
    >
      Add a location
    </NuxtLink>

    <div
      v-if="status === 'pending'"
      class="card p-6 text-center text-sm text-[var(--color-ink-500)]"
      role="status"
    >
      Loading locations…
    </div>

    <p
      v-else-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ apiErrorMessage(error) }}</span>
    </p>

    <template v-else-if="data?.items.length">
      <LocationGroupedList :items="data.items">
        <template #default="{ item }">
          <button
            type="button"
            class="wiz-pick"
            @click="navigateTo(`/locations/${item.id}`)"
          >
            <span
              class="wiz-pick-ico"
              aria-hidden="true"
            >
              <LocationIcon :name="item.type" />
            </span>
            <span class="wiz-pick-main">
              <b>{{ item.name }}</b>
              <small>{{ addressLine(item) }}</small>
            </span>
            <span class="wiz-pick-end">
              <small>{{ item.occupancy }} on site</small>
              <span
                class="wiz-chev"
                aria-hidden="true"
              >›</span>
            </span>
          </button>
        </template>
      </LocationGroupedList>
    </template>

    <EmptyState
      v-else
      glyph="⌂"
      title="No locations yet"
      description="Add a yard, terminal, or customer."
    >
      <NuxtLink
        to="/locations/new"
        class="btn-ghost"
      >
        Add a location
      </NuxtLink>
    </EmptyState>
  </section>
</template>
