<script setup lang="ts">
import { TRIP_STATUS_CHIP, TRIP_STATUS_LABELS } from '#shared/utils/domain'
import type { TripStatus } from '#shared/utils/domain'

useHead({ title: 'Pickups & drop-offs' })

const statusFilter = ref<TripStatus | 'ALL'>('ALL')

const { data, status, error } = await useFetch('/api/trips', {
  query: computed(() => ({
    scope: 'mine',
    status: statusFilter.value === 'ALL' ? undefined : statusFilter.value,
    limit: 100,
  })),
})

/** Grouped by calendar day, newest first — mirrors the design template. */
const grouped = computed(() => {
  const items = data.value?.items ?? []
  const groups = new Map<string, typeof items>()

  for (const trip of items) {
    const key = new Date(trip.createdAt).toISOString().slice(0, 10)
    const bucket = groups.get(key) ?? []
    bucket.push(trip)
    groups.set(key, bucket)
  }

  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]))
})

const QUICK_FILTERS: Array<{ value: TripStatus | 'ALL', label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'IN_TRANSIT', label: 'In transit' },
  { value: 'PICKUP_IN_PROGRESS', label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'EXCEPTION', label: 'Exceptions' },
]

function dayLabel(isoDate: string) {
  const today = new Date().toISOString().slice(0, 10)
  if (isoDate === today) return `Today · ${formatWorkDate(isoDate)}`
  return formatWorkDate(isoDate)
}
</script>

<template>
  <section class="d-page">
    <PageHeader
      eyebrow="Pickups &amp; drop-offs"
      title="My movements"
    />

    <div
      class="mb-4 flex gap-2 overflow-x-auto pb-1"
      role="group"
      aria-label="Filter movements by status"
    >
      <button
        v-for="filter in QUICK_FILTERS"
        :key="filter.value"
        type="button"
        class="fchip"
        :class="{ on: statusFilter === filter.value }"
        :aria-pressed="statusFilter === filter.value"
        @click="statusFilter = filter.value"
      >
        {{ filter.label }}
      </button>
    </div>

    <NuxtLink
      to="/pickups/new"
      class="btn-primary-action mb-5"
    >
      New Pickup
    </NuxtLink>

    <div
      v-if="status === 'pending'"
      class="card p-6 text-center text-sm text-[var(--color-ink-500)]"
      role="status"
    >
      Loading movements…
    </div>

    <p
      v-else-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ apiErrorMessage(error) }}</span>
    </p>

    <template v-else-if="grouped.length">
      <div
        v-for="[day, trips] in grouped"
        :key="day"
        class="mb-6"
      >
        <h2 class="mb-2 font-[family-name:var(--font-display)] text-sm font-semibold text-[var(--color-ink-700)]">
          {{ dayLabel(day) }}
        </h2>

        <div class="card rowlist">
          <NuxtLink
            v-for="trip in trips"
            :key="trip.id"
            :to="`/trips/${trip.id}`"
            class="row"
          >
            <span
              class="row-ico"
              aria-hidden="true"
            >⇄</span>
            <span class="row-main">
              <b class="mono">{{ trip.containerNumber ?? trip.reference }}</b>
              <small>{{ trip.originName ?? 'No origin' }} · {{ formatTime(trip.createdAt) }} · {{ trip.reference }}</small>
            </span>
            <span class="row-end">
              <StatusChip
                :variant="TRIP_STATUS_CHIP[trip.status]"
                :label="TRIP_STATUS_LABELS[trip.status]"
              />
            </span>
          </NuxtLink>
        </div>
      </div>
    </template>

    <EmptyState
      v-else
      glyph="⇄"
      title="No movements yet"
      :description="statusFilter === 'ALL' ? 'Start a pickup and it will appear here.' : `No movements match ${TRIP_STATUS_LABELS[statusFilter as TripStatus]}.`"
    >
      <button
        v-if="statusFilter !== 'ALL'"
        class="btn-ghost"
        @click="statusFilter = 'ALL'"
      >
        Clear filter
      </button>
    </EmptyState>
  </section>
</template>
