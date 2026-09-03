<script setup lang="ts">
import type { LocationType } from '#shared/utils/domain'
import { LOCATION_TYPE_LABELS, LOCATION_TYPES } from '#shared/utils/domain'

definePageMeta({ layout: 'admin' })
useHead({ title: 'Locations & yards · Management' })

/* Location status vocabulary is page-local: domain.ts does not export it yet. */
type LocationStatus = 'ACTIVE' | 'PENDING_APPROVAL' | 'ARCHIVED'

const LOCATION_STATUS_LABELS: Record<LocationStatus, string> = {
  ACTIVE: 'Active',
  PENDING_APPROVAL: 'Pending approval',
  ARCHIVED: 'Archived',
}

const LOCATION_STATUS_CHIP: Record<LocationStatus, 'ok' | 'warn' | 'err' | 'transit' | 'idle'> = {
  ACTIVE: 'ok',
  PENDING_APPROVAL: 'warn',
  ARCHIVED: 'idle',
}

/* --- Filters ------------------------------------------------------ */
const searchInput = ref('')
const q = ref('')
const type = ref<LocationType | ''>('')

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchInput, (value) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    q.value = value.trim()
  }, 300)
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

const { data, status, error, refresh } = await useFetch('/api/locations', {
  query: computed(() => ({
    q: q.value || undefined,
    type: type.value || undefined,
    includeUncategorized: '1',
  })),
})

const rows = computed(() => data.value?.items ?? [])

function occupancyPercent(occupancy: number, capacity: number | null): number {
  if (!capacity || capacity <= 0) return 0
  return Math.min(100, Math.round((occupancy / capacity) * 100))
}
</script>

<template>
  <div>
    <div class="a-head">
      <div>
        <span class="eyebrow">Operations</span>
        <h1>Locations & yards</h1>
      </div>
      <NuxtLink
        to="/locations/new"
        class="btn-dark w-auto"
      >
        ＋ New location
      </NuxtLink>
    </div>

    <div class="a-toolbar">
      <label class="searchbar">
        <span class="sr-only">Search locations</span>
        <span aria-hidden="true">⌕</span>
        <input
          v-model="searchInput"
          type="search"
          placeholder="Name, address, city, location code…"
        >
      </label>
    </div>

    <div
      class="a-toolbar"
      role="group"
      aria-label="Location type filter"
    >
      <button
        class="fchip min-h-11"
        :class="{ on: type === '' }"
        :aria-pressed="type === ''"
        @click="type = ''"
      >
        All types
      </button>
      <button
        v-for="value in LOCATION_TYPES"
        :key="value"
        class="fchip min-h-11 inline-flex items-center gap-1.5"
        :class="{ on: type === value }"
        :aria-pressed="type === value"
        @click="type = value"
      >
        <LocationIcon
          :name="value"
          :size="16"
        />
        {{ LOCATION_TYPE_LABELS[value] }}
      </button>
    </div>

    <div
      v-if="status === 'pending'"
      class="card p-5"
      role="status"
    >
      <span class="sr-only">Loading locations…</span>
      <div
        class="space-y-3"
        aria-hidden="true"
      >
        <div class="h-4 w-1/3 animate-pulse rounded bg-[var(--color-paper-100)]" />
        <div class="h-4 w-2/3 animate-pulse rounded bg-[var(--color-paper-100)]" />
        <div class="h-4 w-1/2 animate-pulse rounded bg-[var(--color-paper-100)]" />
      </div>
    </div>

    <div
      v-else-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>
        <b>Could not load locations</b>
        {{ apiErrorMessage(error) }}
      </span>
      <button
        class="btn-ghost ml-auto"
        @click="refresh()"
      >
        Try again
      </button>
    </div>

    <div
      v-else-if="rows.length"
      class="table-wrap"
    >
      <table class="dtable">
        <caption class="sr-only">
          Locations matching the current filters
        </caption>
        <thead>
          <tr>
            <th scope="col">
              Name
            </th>
            <th scope="col">
              Type
            </th>
            <th scope="col">
              Address
            </th>
            <th scope="col">
              Occupancy
            </th>
            <th scope="col">
              Boundary
            </th>
            <th scope="col">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.id"
          >
            <td>
              <NuxtLink
                :to="`/locations/${row.id}`"
                class="flex min-h-11 items-center gap-2 font-semibold"
              >
                <LocationIcon
                  :name="row.type"
                  :size="22"
                />
                {{ row.name }}
              </NuxtLink>
            </td>
            <td>{{ LOCATION_TYPE_LABELS[row.type] }}</td>
            <td>
              <span class="block">{{ row.addressLine1 ?? '—' }}</span>
              <small class="text-[var(--color-ink-500)]">
                {{ [row.city, row.state].filter(Boolean).join(', ') || '—' }}
              </small>
            </td>
            <td>
              <div
                v-if="row.capacity"
                class="flex items-center gap-2"
              >
                <div
                  class="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--color-paper-100)]"
                  aria-hidden="true"
                >
                  <div
                    class="h-full rounded-full"
                    :class="row.occupancy > row.capacity ? 'bg-[var(--color-err-600)]' : 'bg-[var(--color-blue-500)]'"
                    :style="{ width: `${occupancyPercent(row.occupancy, row.capacity)}%` }"
                  />
                </div>
                <span class="text-xs tabular-nums">{{ row.occupancy }} / {{ row.capacity }}</span>
              </div>
              <span
                v-else
                class="text-xs"
              >{{ row.occupancy }} on site</span>
            </td>
            <td>
              <NuxtLink
                v-if="!row.hasBoundary && !row.isUncategorized"
                :to="`/locations/${row.id}/yard/setup`"
                class="inline-flex min-h-11 items-center"
              >
                <StatusChip
                  variant="warn"
                  label="Draw zone"
                />
              </NuxtLink>
              <StatusChip
                v-else
                :variant="row.hasBoundary ? 'ok' : 'warn'"
                :label="row.hasBoundary ? 'Boundary drawn' : 'No boundary'"
              />
            </td>
            <td>
              <StatusChip
                :variant="LOCATION_STATUS_CHIP[row.status]"
                :label="LOCATION_STATUS_LABELS[row.status]"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <EmptyState
      v-else
      glyph="◫"
      title="No locations match"
      description="Create the terminals, yards and customer sites your drivers work with."
    >
      <NuxtLink
        to="/locations/new"
        class="btn-ghost"
      >
        Create a location
      </NuxtLink>
    </EmptyState>
  </div>
</template>
