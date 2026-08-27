<script setup lang="ts">
import { TRIP_STATUS_CHIP, TRIP_STATUS_GLYPH, TRIP_STATUS_LABELS } from '#shared/utils/domain'
import type { TripStatus } from '#shared/utils/domain'
import { formatChassisNumber, formatContainerNumber } from '#shared/utils/iso6346'

useHead({ title: 'My Trips' })

const view = ref<'list' | 'calendar'>('list')
const dayFilter = ref<'all' | 'today'>('all')
const cursor = ref(new Date())

const { data, status, error } = await useFetch('/api/trips', {
  query: { scope: 'mine', limit: 200 },
})

const todayIso = computed(() => new Date().toISOString().slice(0, 10))

const trips = computed(() => data.value?.items ?? [])

const visibleTrips = computed(() => {
  if (dayFilter.value !== 'today') return trips.value
  return trips.value.filter((trip) => {
    const stamp = trip.pickedUpAt ?? trip.createdAt
    return toIsoDate(stamp) === todayIso.value
  })
})

/** Week → day → trips, newest week first. */
const grouped = computed(() => {
  const weeks = new Map<string, Map<string, typeof visibleTrips.value>>()

  for (const trip of visibleTrips.value) {
    const iso = toIsoDate(trip.pickedUpAt ?? trip.createdAt) ?? todayIso.value
    const weekKey = startOfWeekMonday(iso).toISOString().slice(0, 10)
    const days = weeks.get(weekKey) ?? new Map()
    const bucket = days.get(iso) ?? []
    bucket.push(trip)
    days.set(iso, bucket)
    weeks.set(weekKey, days)
  }

  return [...weeks.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([week, days]) => ({
      week,
      label: formatWeekRange(week),
      days: [...days.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([iso, items]) => ({ iso, label: formatDayHeading(iso, todayIso.value), items })),
    }))
})

const tripDays = computed(() => {
  const set = new Set<string>()
  for (const trip of trips.value) {
    const iso = toIsoDate(trip.pickedUpAt ?? trip.createdAt)
    if (iso) set.add(iso)
  }
  return set
})

const calendarCells = computed(() => {
  const year = cursor.value.getFullYear()
  const month = cursor.value.getMonth()
  const first = new Date(year, month, 1)
  const startOffset = first.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const prevDays = new Date(year, month, 0).getDate()
  const cells: Array<{ day: number, iso: string, muted: boolean, today: boolean, hasTrip: boolean }> = []

  for (let i = startOffset - 1; i >= 0; i--) {
    const day = prevDays - i
    const date = new Date(year, month - 1, day)
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    cells.push({ day, iso, muted: true, today: false, hasTrip: tripDays.value.has(iso) })
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    cells.push({
      day,
      iso,
      muted: false,
      today: iso === todayIso.value,
      hasTrip: tripDays.value.has(iso),
    })
  }

  while (cells.length % 7 !== 0) {
    const day = cells.length - (startOffset + daysInMonth) + 1
    const date = new Date(year, month + 1, day)
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    cells.push({ day, iso, muted: true, today: false, hasTrip: tripDays.value.has(iso) })
  }

  return cells
})

const monthLabel = computed(() =>
  new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(cursor.value),
)

function shiftMonth(delta: number) {
  const next = new Date(cursor.value)
  next.setMonth(next.getMonth() + delta)
  cursor.value = next
}

function rowIconStyle(statusKey: TripStatus) {
  const variant = TRIP_STATUS_CHIP[statusKey]
  if (variant === 'ok') return { background: 'var(--color-ok-100)', color: 'var(--color-ok-600)' }
  if (variant === 'err') return { background: 'var(--color-err-100)', color: 'var(--color-err-600)' }
  if (variant === 'warn') return { background: 'var(--color-warn-100)', color: 'var(--color-warn-600)' }
  if (variant === 'transit') return { background: 'var(--color-info-100)', color: 'var(--color-info-600)' }
  return { background: 'var(--color-paper-100)', color: 'var(--color-ink-500)' }
}

function tripSubtitle(trip: { originName?: string | null, destinationName?: string | null, createdAt: string, pickedUpAt?: string | null, reference: string }) {
  const route = [trip.originName ?? 'No origin', trip.destinationName ?? 'Open dest'].join(' → ')
  return `${route} · ${formatTime(trip.pickedUpAt ?? trip.createdAt)} · ${trip.reference}`
}

function selectDay(iso: string) {
  dayFilter.value = iso === todayIso.value ? 'today' : 'all'
  view.value = 'list'
}
</script>

<template>
  <section class="d-page">
    <span class="eyebrow">Pickups &amp; Drop-offs</span>
    <h1 class="d-title">
      My Trips
    </h1>

    <div class="trips-toolbar">
      <div class="view-toggle">
        <button
          type="button"
          :class="{ on: view === 'list' }"
          @click="view = 'list'"
        >
          List
        </button>
        <button
          type="button"
          :class="{ on: view === 'calendar' }"
          @click="view = 'calendar'"
        >
          Calendar
        </button>
      </div>
      <div class="filters">
        <button
          type="button"
          class="fchip"
          :class="{ on: dayFilter === 'all' }"
          @click="dayFilter = 'all'"
        >
          All
        </button>
        <button
          type="button"
          class="fchip"
          :class="{ on: dayFilter === 'today' }"
          @click="dayFilter = 'today'"
        >
          Today
        </button>
      </div>
    </div>

    <div
      v-if="status === 'pending'"
      class="card p-6 text-center text-sm text-[var(--color-ink-500)]"
      role="status"
    >
      Loading trips…
    </div>

    <p
      v-else-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ apiErrorMessage(error) }}</span>
    </p>

    <template v-else>
      <div
        class="trips-list-wrap"
        :class="{ off: view !== 'list' }"
      >
        <div
          v-if="grouped.length"
          class="trips-list"
        >
          <div
            v-for="week in grouped"
            :key="week.week"
            class="week-block"
          >
            <div class="week-label">
              {{ week.label }}
            </div>
            <div
              v-for="day in week.days"
              :key="day.iso"
              class="day-block"
            >
              <div class="day-label">
                {{ day.label }}
              </div>
              <NuxtLink
                v-for="trip in day.items"
                :key="trip.id"
                :to="`/trips/${trip.id}`"
                class="trip-row"
              >
                <div
                  class="row-ico"
                  :style="rowIconStyle(trip.status)"
                  aria-hidden="true"
                >
                  {{ TRIP_STATUS_GLYPH[trip.status] }}
                </div>
                <div class="row-main">
                  <b class="mono">{{ trip.containerNumber ? (formatContainerNumber(trip.containerNumber) || trip.containerNumber) : (trip.chassisNumber ? (formatChassisNumber(trip.chassisNumber) || trip.chassisNumber) : trip.reference) }}</b>
                  <small>{{ tripSubtitle(trip) }}</small>
                </div>
                <div class="row-end">
                  <StatusChip
                    :variant="TRIP_STATUS_CHIP[trip.status]"
                    :label="TRIP_STATUS_LABELS[trip.status]"
                  />
                </div>
              </NuxtLink>
            </div>
          </div>
        </div>

        <EmptyState
          v-else
          glyph="⇄"
          title="No trips yet"
          :description="dayFilter === 'today' ? 'Nothing recorded today.' : 'Start a pickup and it will appear here.'"
        />
      </div>

      <div
        class="trips-calendar card"
        :class="{ on: view === 'calendar' }"
      >
        <div class="cal-head">
          <button
            type="button"
            class="cal-nav"
            aria-label="Previous month"
            @click="shiftMonth(-1)"
          >
            ‹
          </button>
          <b>{{ monthLabel }}</b>
          <button
            type="button"
            class="cal-nav"
            aria-label="Next month"
            @click="shiftMonth(1)"
          >
            ›
          </button>
        </div>
        <div class="cal-grid">
          <div
            v-for="dow in ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']"
            :key="dow"
            class="cal-dow"
          >
            {{ dow }}
          </div>
          <button
            v-for="cell in calendarCells"
            :key="cell.iso + cell.muted"
            type="button"
            class="cal-day"
            :class="{ 'muted': cell.muted, 'today': cell.today, 'has-trip': cell.hasTrip }"
            @click="selectDay(cell.iso)"
          >
            {{ cell.day }}
          </button>
        </div>
      </div>
    </template>
  </section>
</template>
