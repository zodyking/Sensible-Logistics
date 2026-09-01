<script setup lang="ts">
import { formatPhoneDisplay } from '#shared/utils/phone'

useHead({ title: 'Customers & locations' })

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

function addressLine(item: {
  addressLine1: string | null
  city: string | null
  isUncategorized?: boolean
}) {
  if (item.isUncategorized) return 'Holding site for equipment from deleted locations'
  return [item.addressLine1, item.city].filter(Boolean).join(' · ') || '—'
}
</script>

<template>
  <section class="d-page">
    <PageHeader
      eyebrow="Company pool"
      title="Customers & locations"
      back-to="/more"
      back-label="More"
    />
    <p class="mb-4 text-sm text-[var(--color-ink-500)]">
      Shared across every driver. Pickup and drop-off only select from this list.
    </p>
    <div class="searchbar">
      ⌕
      <input
        v-model="search"
        type="search"
        placeholder="Search location or customer…"
        aria-label="Search locations"
      >
    </div>

    <NuxtLink
      :to="{ path: '/locations/new', query: { returnTo: '/locations' } }"
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
              <small
                v-if="item.mainPhone"
                class="block"
              >
                Main {{ formatPhoneDisplay(item.mainPhone) }}
              </small>
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
      glyph="◫"
      title="No locations yet"
      description="Add a yard, terminal, or customer. Every driver will be able to select it on pickup and drop-off."
    >
      <NuxtLink
        :to="{ path: '/locations/new', query: { returnTo: '/locations' } }"
        class="btn-ghost"
      >
        Add a location
      </NuxtLink>
    </EmptyState>
  </section>
</template>
