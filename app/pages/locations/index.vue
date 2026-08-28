<script setup lang="ts">
import { LOCATION_TYPE_LABELS } from '#shared/utils/domain'
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
  type: keyof typeof LOCATION_TYPE_LABELS
  addressLine1: string | null
  city: string | null
  isUncategorized?: boolean
}) {
  if (item.isUncategorized) return 'Holding site for equipment from deleted locations'
  const bits = [LOCATION_TYPE_LABELS[item.type]]
  if (item.addressLine1) bits.push(item.addressLine1)
  if (item.city) bits.push(item.city)
  return bits.join(' · ')
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
      <div class="card rowlist">
        <button
          v-for="item in data.items"
          :key="item.id"
          type="button"
          class="row"
          @click="navigateTo(`/locations/${item.id}`)"
        >
          <span class="row-main">
            <b>{{ item.name }}</b>
            <small>{{ addressLine(item) }}</small>
            <small
              v-if="item.mainPhone"
              class="block"
            >
              Main {{ formatPhoneDisplay(item.mainPhone) }}
            </small>
          </span>
          <span class="row-end">
            <small>{{ item.occupancy }} on site</small>
            <span aria-hidden="true">›</span>
          </span>
        </button>
      </div>
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
