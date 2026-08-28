<script setup lang="ts">
import { emptyTypeCounts, LOCATION_TYPE_LABELS } from '#shared/utils/domain'
import { formatPhoneDisplay } from '#shared/utils/phone'
import type { GeoJsonPolygon } from '#shared/utils/geo'

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
  query: computed(() => ({ q: debounced.value || undefined, limit: 100 })),
})

function addressLine(item: {
  type: keyof typeof LOCATION_TYPE_LABELS
  addressLine1: string | null
  city: string | null
}) {
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
      <button
        v-for="item in data.items"
        :key="item.id"
        type="button"
        class="loc-card"
        @click="navigateTo(`/locations/${item.id}`)"
      >
        <ClientOnly>
          <LocationYardMap
            mode="preview"
            :boundary="(item.boundary as GeoJsonPolygon | null) ?? null"
            :latitude="item.latitude"
            :longitude="item.longitude"
            :containers="item.containers"
          />
          <template #fallback>
            <div class="location-map preview" />
          </template>
        </ClientOnly>
        <div class="loc-body">
          <div class="loc-top">
            <div class="loc-main">
              <b>{{ item.name }}</b>
              <small>{{ addressLine(item) }}</small>
              <small
                v-if="item.mainPhone"
                class="block"
              >
                Main {{ formatPhoneDisplay(item.mainPhone) }}
              </small>
            </div>
            <span
              class="row-end"
              aria-hidden="true"
            >›</span>
          </div>
          <LocationTypeCounts
            :counts="item.typeCounts ?? emptyTypeCounts()"
            :occupancy="item.occupancy"
          />
        </div>
      </button>
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
