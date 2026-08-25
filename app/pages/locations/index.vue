<script setup lang="ts">
import { LOCATION_GLYPH, LOCATION_TYPE_LABELS } from '#shared/utils/domain'

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
  query: computed(() => ({ q: debounced.value || undefined, limit: 100 })),
})

function occupancyPercent(item: { occupancy: number, capacity: number | null }) {
  if (!item.capacity) return null
  return Math.min(100, Math.round((item.occupancy / item.capacity) * 100))
}
</script>

<template>
  <section class="d-page">
    <PageHeader
      eyebrow="Location pool"
      title="Locations"
    />

    <div class="searchbar">
      <span aria-hidden="true">⌕</span>
      <input
        v-model="search"
        type="search"
        placeholder="Yards, terminals, customers…"
        aria-label="Search locations"
      >
    </div>

    <NuxtLink
      to="/locations/new"
      class="btn-dark mb-5"
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
      <NuxtLink
        v-for="item in data.items"
        :key="item.id"
        :to="`/containers?locationId=${item.id}`"
        class="card mb-3 block p-4"
      >
        <div class="flex items-center gap-3">
          <span
            class="grid size-11 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--color-navy-800)] text-lg text-[var(--color-amber-500)]"
            aria-hidden="true"
          >{{ LOCATION_GLYPH[item.type] }}</span>
          <span class="min-w-0 flex-1">
            <b class="block font-[family-name:var(--font-display)] text-lg font-semibold">{{ item.name }}</b>
            <small class="text-xs text-[var(--color-ink-500)]">
              {{ LOCATION_TYPE_LABELS[item.type] }}
              <template v-if="item.addressLine1"> · {{ item.addressLine1 }}</template>
            </small>
          </span>
          <span
            class="text-[var(--color-ink-400)]"
            aria-hidden="true"
          >›</span>
        </div>

        <div class="mt-3 flex items-center gap-3">
          <div
            v-if="occupancyPercent(item) !== null"
            class="h-[7px] flex-1 overflow-hidden rounded bg-[var(--color-paper-100)]"
            role="progressbar"
            :aria-valuenow="occupancyPercent(item) ?? 0"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="`${item.name} occupancy`"
          >
            <span
              class="block h-full rounded"
              :class="(occupancyPercent(item) ?? 0) >= 95 ? 'bg-[var(--color-err-600)]' : (occupancyPercent(item) ?? 0) >= 80 ? 'bg-[var(--color-amber-500)]' : 'bg-[var(--color-blue-500)]'"
              :style="{ width: `${occupancyPercent(item)}%` }"
            />
          </div>
          <small class="shrink-0 text-xs font-bold text-[var(--color-ink-500)]">
            {{ item.occupancy }}<template v-if="item.capacity"> / {{ item.capacity }}</template> containers
          </small>
          <StatusChip
            v-if="!item.hasBoundary"
            variant="idle"
            label="No boundary"
          />
        </div>
      </NuxtLink>
    </template>

    <EmptyState
      v-else
      glyph="◫"
      title="No locations yet"
      description="Add the yards, terminals, depots and customers your company works with."
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
