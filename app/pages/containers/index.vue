<script setup lang="ts">
import { LOCATION_GLYPH, LOCATION_TYPE_LABELS } from '#shared/utils/domain'

useHead({ title: 'Locations' })

const route = useRoute()
const router = useRouter()

const search = ref('')
const debounced = ref('')
const selectedId = ref<string | null>(typeof route.query.locationId === 'string' ? route.query.locationId : null)

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

const { data: yard, status: yardStatus, error: yardError } = await useAsyncData(
  'yard-location',
  () => selectedId.value
    ? $fetch(`/api/locations/${selectedId.value}`)
    : Promise.resolve(null),
  { watch: [selectedId] },
)

const selectedLocation = computed(() => {
  if (!selectedId.value) return null
  return yard.value?.location ?? data.value?.items.find(item => item.id === selectedId.value) ?? null
})

const yardContainers = computed(() => yard.value?.containers ?? [])

watch(selectedId, (id) => {
  if (id) {
    router.replace({ path: '/containers', query: { locationId: id } })
  }
  else if (route.query.locationId) {
    router.replace({ path: '/containers' })
  }
})

function occupancyPercent(item: { occupancy?: number, capacity: number | null }) {
  if (!item.capacity || item.occupancy == null) return null
  return Math.min(100, Math.round((item.occupancy / item.capacity) * 100))
}

function barClass(percent: number | null) {
  if (percent == null) return ''
  if (percent >= 95) return 'hot'
  if (percent >= 80) return 'warm'
  return ''
}

function selectLocation(id: string) {
  selectedId.value = id
}

function backToLocations() {
  selectedId.value = null
}
</script>

<template>
  <section class="d-page">
    <!-- View 1 · Locations -->
    <template v-if="!selectedId">
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
          @click="selectLocation(item.id)"
        >
          <div class="loc-top">
            <div
              class="loc-glyph"
              aria-hidden="true"
            >
              {{ LOCATION_GLYPH[item.type] }}
            </div>
            <div class="loc-main">
              <b>{{ item.name }}</b>
              <small>
                {{ LOCATION_TYPE_LABELS[item.type] }}
                <template v-if="item.addressLine1"> · {{ item.addressLine1 }}</template>
                <template v-if="item.city">, {{ item.city }}</template>
              </small>
            </div>
            <span
              class="row-end"
              aria-hidden="true"
            >›</span>
          </div>
          <div class="loc-occ">
            <div class="bar">
              <i
                :class="barClass(occupancyPercent(item))"
                :style="{ width: `${occupancyPercent(item) ?? Math.min(100, item.occupancy * 8)}%` }"
              />
            </div>
            <small>
              {{ item.occupancy }}<template v-if="item.capacity"> / {{ item.capacity }}</template>
            </small>
          </div>
        </button>
      </template>

      <EmptyState
        v-else
        glyph="◫"
        title="No locations yet"
        description="Add the yards, terminals and customers you work with."
      >
        <NuxtLink
          to="/locations/new"
          class="btn-ghost"
        >
          Add a location
        </NuxtLink>
      </EmptyState>
    </template>

    <!-- View 2 · Yard map -->
    <template v-else>
      <div class="backbar">
        <button
          type="button"
          class="backbtn"
          @click="backToLocations"
        >
          ‹ Locations
        </button>
      </div>
      <h1
        class="d-title"
        style="margin-top: 0"
      >
        {{ selectedLocation?.name ?? 'Yard' }}
      </h1>

      <p
        v-if="yardError"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ apiErrorMessage(yardError) }}</span>
      </p>

      <p
        v-else-if="yardStatus === 'pending'"
        class="card p-6 text-center text-sm text-[var(--color-ink-500)]"
        role="status"
      >
        Loading yard…
      </p>

      <YardStage
        v-else
        :location-name="selectedLocation?.name ?? 'Yard'"
        :street-label="selectedLocation && 'addressLine1' in selectedLocation ? selectedLocation.addressLine1 : null"
        :containers="yardContainers"
      />
    </template>
  </section>
</template>
