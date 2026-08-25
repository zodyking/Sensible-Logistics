<script setup lang="ts">
import { formatPhoneDisplay } from '#shared/utils/phone'

definePageMeta({ layout: 'admin' })
useHead({ title: 'Drivers & timecards · Management' })

/* Duty/membership vocabularies are page-local: domain.ts does not export them yet. */
const DRIVER_STATUSES = ['AVAILABLE', 'ON_TRIP', 'OFF_DUTY', 'INACTIVE'] as const
type DriverStatus = (typeof DRIVER_STATUSES)[number]

const DRIVER_STATUS_LABELS: Record<DriverStatus, string> = {
  AVAILABLE: 'Available',
  ON_TRIP: 'On trip',
  OFF_DUTY: 'Off duty',
  INACTIVE: 'Inactive',
}

const DRIVER_STATUS_CHIP: Record<DriverStatus, 'ok' | 'warn' | 'err' | 'transit' | 'idle'> = {
  AVAILABLE: 'ok',
  ON_TRIP: 'transit',
  OFF_DUTY: 'idle',
  INACTIVE: 'warn',
}

type MembershipStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED'

const MEMBERSHIP_LABELS: Record<MembershipStatus, string> = {
  PENDING: 'Pending',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
}

const MEMBERSHIP_CHIP: Record<MembershipStatus, 'ok' | 'warn' | 'err' | 'transit' | 'idle'> = {
  PENDING: 'warn',
  ACTIVE: 'ok',
  SUSPENDED: 'err',
}

const ROLE_LABELS: Record<'DRIVER' | 'ADMIN', string> = {
  DRIVER: 'Driver',
  ADMIN: 'Admin',
}

/* --- Filters ------------------------------------------------------ */
const searchInput = ref('')
const q = ref('')
const dutyStatus = ref<DriverStatus | ''>('')

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

const { data, status, error, refresh } = await useFetch('/api/admin/drivers', {
  query: computed(() => ({
    q: q.value || undefined,
    status: dutyStatus.value || undefined,
  })),
})

const rows = computed(() => data.value?.items ?? [])

/** Local calendar date for the "today" DOT time record links. */
const today = computed(() => {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
})
</script>

<template>
  <div>
    <div class="a-head">
      <div>
        <span class="eyebrow">Operations</span>
        <h1>Drivers & timecards</h1>
      </div>
      <p class="text-sm text-[var(--color-ink-500)]">
        Roster, duty state, and each driver's §395.1(e)(1) time record.
      </p>
    </div>

    <div class="a-toolbar">
      <label class="searchbar">
        <span class="sr-only">Search drivers</span>
        <span aria-hidden="true">⌕</span>
        <input
          v-model="searchInput"
          type="search"
          placeholder="Name, email, driver code, CDL…"
        >
      </label>
    </div>

    <div
      class="a-toolbar"
      role="group"
      aria-label="Duty status filter"
    >
      <button
        class="fchip min-h-11"
        :class="{ on: dutyStatus === '' }"
        :aria-pressed="dutyStatus === ''"
        @click="dutyStatus = ''"
      >
        All
      </button>
      <button
        v-for="value in DRIVER_STATUSES"
        :key="value"
        class="fchip min-h-11"
        :class="{ on: dutyStatus === value }"
        :aria-pressed="dutyStatus === value"
        @click="dutyStatus = value"
      >
        {{ DRIVER_STATUS_LABELS[value] }}
      </button>
    </div>

    <p class="banner info">
      <span aria-hidden="true">ℹ</span>
      <span>
        <b>Timecard corrections are audited</b>
        A correction never overwrites a driver's punch: it is stored as an immutable, admin-originated
        correction event with the original value preserved, and time records are retained for at least
        6 months. Submitting corrections from this page arrives in Phase 2.
      </span>
    </p>

    <div
      v-if="status === 'pending'"
      class="card p-5"
      role="status"
    >
      <span class="sr-only">Loading drivers…</span>
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
        <b>Could not load drivers</b>
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
          Drivers matching the current filters
        </caption>
        <thead>
          <tr>
            <th scope="col">
              Driver
            </th>
            <th scope="col">
              Code / CDL
            </th>
            <th scope="col">
              Role
            </th>
            <th scope="col">
              Membership
            </th>
            <th scope="col">
              Duty status
            </th>
            <th scope="col">
              Active movements
            </th>
            <th scope="col">
              Last login
            </th>
            <th scope="col">
              DOT record
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.id"
          >
            <td>
              <b class="block">{{ row.firstName }} {{ row.lastName }}</b>
              <small class="block text-[var(--color-ink-500)]">{{ row.email }}</small>
              <small
                v-if="row.mobileNumber"
                class="block text-[var(--color-ink-500)]"
              >
                <a :href="`tel:${row.mobileNumber}`">{{ formatPhoneDisplay(row.mobileNumber) }}</a>
              </small>
            </td>
            <td>
              <span class="mono block">{{ row.driverCode ?? '—' }}</span>
              <small class="mono text-[var(--color-ink-500)]">{{ row.cdlNumber ?? 'No CDL on file' }}</small>
            </td>
            <td>{{ row.role ? ROLE_LABELS[row.role] : '—' }}</td>
            <td>
              <StatusChip
                v-if="row.membershipStatus"
                :variant="MEMBERSHIP_CHIP[row.membershipStatus]"
                :label="MEMBERSHIP_LABELS[row.membershipStatus]"
              />
              <span v-else>—</span>
            </td>
            <td>
              <div class="flex flex-wrap gap-1">
                <StatusChip
                  :variant="DRIVER_STATUS_CHIP[row.status]"
                  :label="DRIVER_STATUS_LABELS[row.status]"
                />
                <StatusChip
                  v-if="row.openTimecardId"
                  variant="transit"
                  label="Open duty tour"
                />
              </div>
            </td>
            <td>{{ row.activeTrips }}</td>
            <td>{{ formatRelative(row.lastLoginAt) }}</td>
            <td>
              <NuxtLink
                :to="`/timecard/${today}/record?driverId=${row.id}`"
                class="inline-flex min-h-11 items-center"
              >
                Time record
              </NuxtLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <EmptyState
      v-else
      glyph="☰"
      title="No drivers match"
      description="Drivers join through public signup with your company invite code, or adjust the filters above."
    >
      <NuxtLink
        to="/admin/settings"
        class="btn-ghost"
      >
        View invite code
      </NuxtLink>
    </EmptyState>
  </div>
</template>
