<script setup lang="ts">
import { countDayWork, formatDayWorkSummary, sortTripsForDay, tripOccursOnDay, tripPickupDay, toLocalIsoDate } from '#shared/utils/trip-days'
import { taskAddedDate } from '#shared/utils/task-days'
import { findTripGaps, resolutionMap, type GapResolution, type TripGap } from '#shared/utils/trip-gaps'

useHead({ title: 'My Trips' })

const view = ref<'list' | 'calendar'>('list')
const dayFilter = ref<'all' | 'today'>('all')
const cursor = ref(new Date())
const selectedIso = ref(toLocalIsoDate(new Date()) ?? '')

const { data, status, error, refresh } = await useFetch('/api/trips', {
  query: { scope: 'mine', limit: 200 },
})
const { data: taskData } = await useFetch('/api/tasks')

const todayIso = computed(() => toLocalIsoDate(new Date()) ?? '')

const trips = computed(() => data.value?.items ?? [])
const gaps = computed(() => findTripGaps(trips.value))
const resolutions = computed(() => resolutionMap(data.value?.gapResolutions))
const historyTasks = computed(() =>
  (taskData.value?.tasks ?? []).filter(task => task.status !== 'DISMISSED'),
)
const tasksByDate = computed(() => {
  const map = new Map<string, typeof historyTasks.value>()
  for (const task of historyTasks.value) {
    const iso = taskAddedDate(task)
    const bucket = map.get(iso) ?? []
    bucket.push(task)
    map.set(iso, bucket)
  }
  return map
})

const visibleTrips = computed(() => {
  if (dayFilter.value !== 'today') return trips.value
  return trips.value.filter(trip => tripOccursOnDay(trip, todayIso.value))
})

/** Week → day → trips, newest week first. Days are pickup (or opened) dates. */
const grouped = computed(() => {
  const weeks = new Map<string, Map<string, typeof visibleTrips.value>>()

  function ensureDay(iso: string) {
    const weekKey = startOfWeekMonday(iso).toISOString().slice(0, 10)
    const days = weeks.get(weekKey) ?? new Map()
    if (!days.has(iso)) days.set(iso, [])
    weeks.set(weekKey, days)
    return days
  }

  for (const trip of visibleTrips.value) {
    const pickupIso = tripPickupDay(trip) ?? todayIso.value
    const listIso = dayFilter.value === 'today' ? todayIso.value : pickupIso
    const days = ensureDay(listIso)
    const bucket = days.get(listIso) ?? []
    bucket.push(trip)
    days.set(listIso, bucket)
    const dropIso = toLocalIsoDate(trip.droppedOffAt)
    if (dayFilter.value !== 'today' && dropIso && dropIso !== pickupIso) ensureDay(dropIso)
  }

  for (const iso of tasksByDate.value.keys()) {
    if (dayFilter.value === 'today' && iso !== todayIso.value) continue
    ensureDay(iso)
  }

  return [...weeks.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([week, days]) => ({
      week,
      label: formatWeekRange(week),
      days: [...days.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([iso, items]) => ({
          iso,
          label: formatDayHeading(iso, todayIso.value),
          summary: formatDayWorkSummary(countDayWork(visibleTrips.value, iso)),
          items: sortTripsForDay(items, iso),
          tasks: tasksByDate.value.get(iso) ?? [],
        })),
    }))
})

const tripDays = computed(() => {
  const set = new Set<string>()
  for (const trip of trips.value) {
    for (const iso of [tripPickupDay(trip), toLocalIsoDate(trip.droppedOffAt)]) {
      if (iso) set.add(iso)
    }
  }
  for (const iso of tasksByDate.value.keys()) set.add(iso)
  return set
})

const calendarCells = computed(() => {
  const year = cursor.value.getFullYear()
  const month = cursor.value.getMonth()
  const first = new Date(year, month, 1)
  const startOffset = first.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const prevDays = new Date(year, month, 0).getDate()
  const cells: Array<{ day: number, iso: string, muted: boolean, today: boolean, selected: boolean, hasTrip: boolean }> = []

  for (let i = startOffset - 1; i >= 0; i--) {
    const day = prevDays - i
    const date = new Date(year, month - 1, day)
    const iso = toLocalIsoDate(date)!
    cells.push({
      day,
      iso,
      muted: true,
      today: iso === todayIso.value,
      selected: iso === selectedIso.value,
      hasTrip: tripDays.value.has(iso),
    })
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    cells.push({
      day,
      iso,
      muted: false,
      today: iso === todayIso.value,
      selected: iso === selectedIso.value,
      hasTrip: tripDays.value.has(iso),
    })
  }

  while (cells.length % 7 !== 0) {
    const day = cells.length - (startOffset + daysInMonth) + 1
    const date = new Date(year, month + 1, day)
    const iso = toLocalIsoDate(date)!
    cells.push({
      day,
      iso,
      muted: true,
      today: iso === todayIso.value,
      selected: iso === selectedIso.value,
      hasTrip: tripDays.value.has(iso),
    })
  }

  return cells
})

const monthLabel = computed(() =>
  new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(cursor.value),
)

const selectedDayLabel = computed(() => formatDayHeading(selectedIso.value, todayIso.value))
const selectedDaySummary = computed(() => formatDayWorkSummary(countDayWork(trips.value, selectedIso.value)))

const selectedDayTrips = computed(() =>
  sortTripsForDay(
    trips.value.filter(trip => tripOccursOnDay(trip, selectedIso.value)),
    selectedIso.value,
  ),
)

const selectedDayTasks = computed(() => tasksByDate.value.get(selectedIso.value) ?? [])
const gapError = ref('')

function shiftMonth(delta: number) {
  const next = new Date(cursor.value)
  next.setMonth(next.getMonth() + delta)
  cursor.value = next
}

function selectDay(iso: string) {
  selectedIso.value = iso
  const [year, month] = iso.split('-').map(Number)
  if (year && month) {
    const next = new Date(year, month - 1, 1)
    if (next.getFullYear() !== cursor.value.getFullYear() || next.getMonth() !== cursor.value.getMonth()) {
      cursor.value = next
    }
  }
}

async function resolveGap(gap: TripGap, resolution: GapResolution) {
  gapError.value = ''
  try {
    await $fetch('/api/trips/gaps', {
      method: 'POST',
      body: {
        priorTripId: gap.priorTripId,
        nextTripId: gap.nextTripId,
        resolution,
      },
    })
    await refresh()
  }
  catch (err) {
    gapError.value = apiErrorMessage(err)
  }
}

function calendarDayLabel(cell: { iso: string, hasTrip: boolean, selected: boolean, today: boolean }) {
  const date = formatDayHeading(cell.iso, todayIso.value)
  const parts = [date]
  if (cell.today) parts.push('today')
  if (cell.selected) parts.push('selected')
  if (cell.hasTrip) parts.push('has trips or tasks')
  return parts.join(', ')
}
</script>

<template>
  <section class="d-page">
    <span class="eyebrow">Pickups &amp; Drop-offs</span>
    <h1 class="d-title">
      My Trips
    </h1>

    <div class="trips-toolbar">
      <div
        class="view-toggle"
        role="tablist"
        aria-label="Trip view"
      >
        <button
          type="button"
          role="tab"
          :aria-selected="view === 'list'"
          :class="{ on: view === 'list' }"
          @click="view = 'list'"
        >
          List
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="view === 'calendar'"
          :class="{ on: view === 'calendar' }"
          @click="view = 'calendar'"
        >
          Calendar
        </button>
      </div>
      <div
        v-if="view === 'list'"
        class="filters"
        role="group"
        aria-label="Day filter"
      >
        <button
          type="button"
          class="fchip"
          :class="{ on: dayFilter === 'all' }"
          :aria-pressed="dayFilter === 'all'"
          @click="dayFilter = 'all'"
        >
          All
        </button>
        <button
          type="button"
          class="fchip"
          :class="{ on: dayFilter === 'today' }"
          :aria-pressed="dayFilter === 'today'"
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
      <p
        v-if="gapError"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ gapError }}</span>
      </p>
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
                <span>{{ day.label }}</span>
                <small
                  v-if="day.summary"
                  class="day-summary"
                >{{ day.summary }}</small>
              </div>
              <DayWorkCard
                :tasks="day.tasks"
                :work-date="day.iso"
              />
              <TripHistoryRows
                :trips="day.items"
                :gaps="gaps"
                :resolutions="resolutions"
                @resolve="resolveGap"
              />
            </div>
          </div>
        </div>

        <EmptyState
          v-else
          glyph="⇄"
          title="No trips yet"
          :description="dayFilter === 'today' ? 'Nothing picked up, dropped off, or dispatched today.' : 'Completed pickups, drop-offs, and dispatcher texts will appear here.'"
        />
      </div>

      <div
        class="trips-cal-wrap"
        :class="{ on: view === 'calendar' }"
      >
        <div class="trips-calendar card">
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
              :key="cell.iso + String(cell.muted)"
              type="button"
              class="cal-day"
              :class="{
                'muted': cell.muted,
                'today': cell.today,
                'sel': cell.selected,
                'has-trip': cell.hasTrip,
              }"
              :aria-label="calendarDayLabel(cell)"
              :aria-pressed="cell.selected"
              @click="selectDay(cell.iso)"
            >
              {{ cell.day }}
            </button>
          </div>
        </div>

        <div class="cal-day-panel">
          <div class="section-label">
            <span>{{ selectedDayLabel }}</span>
            <span v-if="selectedDaySummary">{{ selectedDaySummary }}</span>
          </div>

          <DayWorkCard
            :tasks="selectedDayTasks"
            :work-date="selectedIso"
          />

          <TripHistoryRows
            :trips="selectedDayTrips"
            :gaps="gaps"
            :resolutions="resolutions"
            @resolve="resolveGap"
          />

          <EmptyState
            v-if="!selectedDayTrips.length && !selectedDayTasks.length"
            glyph="⇄"
            title="No trips this day"
            description="Nothing was picked up, dropped off, or dispatched on this date."
          />
        </div>
      </div>
    </template>
  </section>
</template>
