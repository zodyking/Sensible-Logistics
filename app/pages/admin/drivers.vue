<script setup lang="ts">
import { formatPhoneDisplay } from '#shared/utils/phone'

definePageMeta({ layout: 'admin' })
useHead({ title: 'Drivers · Dispatch' })

type DriverStatus = 'AVAILABLE' | 'ON_TRIP' | 'OFF_DUTY' | 'INACTIVE'

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
  INACTIVE: 'idle',
}

interface DriverRow {
  id: string
  userId: string
  firstName: string
  lastName: string
  email: string
  mobileNumber: string | null
  driverCode: string | null
  cdlNumber: string | null
  status: DriverStatus
  lastLoginAt: string | null
  lockedAt: string | null
  activeTrips: number
}

const searchInput = ref('')
const q = ref('')
const flash = ref('')

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchInput, (value) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    q.value = value.trim()
  }, 300)
})

let flashTimer: ReturnType<typeof setTimeout> | undefined
watch(flash, (value) => {
  if (flashTimer) clearTimeout(flashTimer)
  if (!value) return
  flashTimer = setTimeout(() => {
    flash.value = ''
  }, 4000)
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
  if (flashTimer) clearTimeout(flashTimer)
})

const { data, status, error, refresh } = await useFetch('/api/admin/drivers', {
  query: computed(() => ({
    q: q.value || undefined,
  })),
})

const rows = computed(() => (data.value?.items ?? []) as DriverRow[])

const menuFor = ref<DriverRow | null>(null)
const confirm = ref<'lock' | 'unlock' | 'password' | null>(null)
const busy = ref(false)
const actionError = ref('')
const issuedPassword = ref('')
const passwordName = ref('')
const copyState = ref<'idle' | 'copied'>('idle')

function initials(row: DriverRow) {
  return `${row.firstName[0] ?? ''}${row.lastName[0] ?? ''}`.toUpperCase() || '—'
}

function openMenu(row: DriverRow) {
  actionError.value = ''
  menuFor.value = row
}

function closeMenu() {
  menuFor.value = null
}

function startConfirm(kind: 'lock' | 'unlock' | 'password') {
  confirm.value = kind
  actionError.value = ''
}

function closeConfirm() {
  if (busy.value) return
  confirm.value = null
  actionError.value = ''
}

async function setLocked(locked: boolean) {
  if (!menuFor.value || busy.value) return
  busy.value = true
  actionError.value = ''
  try {
    await $fetch(`/api/admin/drivers/${menuFor.value.id}/lock`, {
      method: 'PATCH',
      body: { locked },
    })
    flash.value = locked
      ? `${menuFor.value.firstName} ${menuFor.value.lastName} is locked and cannot sign in.`
      : `${menuFor.value.firstName} ${menuFor.value.lastName} can sign in again.`
    confirm.value = null
    menuFor.value = null
    await refresh()
  }
  catch (err) {
    actionError.value = apiErrorMessage(err, locked ? 'Could not lock that account.' : 'Could not unlock that account.')
  }
  finally {
    busy.value = false
  }
}

async function resetPassword() {
  if (!menuFor.value || busy.value) return
  busy.value = true
  actionError.value = ''
  try {
    const result = await $fetch(`/api/admin/drivers/${menuFor.value.id}/password`, {
      method: 'POST',
    })
    issuedPassword.value = result.temporaryPassword
    passwordName.value = result.name
    copyState.value = 'idle'
    confirm.value = null
    menuFor.value = null
    flash.value = ''
  }
  catch (err) {
    actionError.value = apiErrorMessage(err, 'Could not reset that password.')
  }
  finally {
    busy.value = false
  }
}

async function copyPassword() {
  if (!issuedPassword.value) return
  try {
    await navigator.clipboard.writeText(issuedPassword.value)
    copyState.value = 'copied'
  }
  catch {
    copyState.value = 'idle'
  }
}

function closePassword() {
  issuedPassword.value = ''
  passwordName.value = ''
  copyState.value = 'idle'
}
</script>

<template>
  <div>
    <div class="a-head">
      <div>
        <span class="eyebrow">Operations</span>
        <h1>Drivers</h1>
        <p class="a-head-copy">
          People who can sign in as a driver. Lock an account when they leave.
        </p>
      </div>
    </div>

    <div class="a-toolbar">
      <label class="searchbar">
        <span class="sr-only">Search drivers</span>
        <span aria-hidden="true">⌕</span>
        <input
          v-model="searchInput"
          type="search"
          placeholder="Search name, email, code…"
        >
      </label>
    </div>

    <p
      v-if="flash"
      class="banner ok"
      role="status"
    >
      <span aria-hidden="true">✓</span>
      <span>{{ flash }}</span>
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

    <ul
      v-else-if="rows.length"
      class="driver-roster"
    >
      <li
        v-for="row in rows"
        :key="row.id"
        class="driver-card"
        :class="{ locked: Boolean(row.lockedAt) }"
      >
        <div
          class="av"
          aria-hidden="true"
        >
          {{ initials(row) }}
        </div>
        <div class="driver-card-main">
          <div class="driver-card-top">
            <b>{{ row.firstName }} {{ row.lastName }}</b>
            <div class="driver-card-chips">
              <StatusChip
                v-if="row.lockedAt"
                variant="err"
                label="Locked"
              />
              <StatusChip
                v-else
                :variant="DRIVER_STATUS_CHIP[row.status]"
                :label="DRIVER_STATUS_LABELS[row.status]"
              />
            </div>
          </div>
          <p>{{ row.email }}</p>
          <p v-if="row.mobileNumber">
            <a :href="`tel:${row.mobileNumber}`">{{ formatPhoneDisplay(row.mobileNumber) }}</a>
          </p>
          <p class="driver-card-meta">
            <template v-if="row.driverCode">
              {{ row.driverCode }}
              ·
            </template>
            <template v-if="row.activeTrips">
              {{ row.activeTrips }} live {{ row.activeTrips === 1 ? 'trip' : 'trips' }}
              ·
            </template>
            Last in {{ formatRelative(row.lastLoginAt) }}
          </p>
        </div>
        <button
          type="button"
          class="icon-btn driver-card-menu"
          :aria-label="`Actions for ${row.firstName} ${row.lastName}`"
          @click="openMenu(row)"
        >
          ⋮
        </button>
      </li>
    </ul>

    <EmptyState
      v-else
      glyph="☰"
      title="No drivers yet"
      description="Drivers join through public signup with your company invite code."
    >
      <NuxtLink
        to="/admin/settings"
        class="btn-ghost"
      >
        View invite code
      </NuxtLink>
    </EmptyState>

    <BottomSheet
      :open="Boolean(menuFor) && !confirm"
      :title="menuFor ? `${menuFor.firstName} ${menuFor.lastName}` : 'Driver'"
      @close="closeMenu"
    >
      <button
        v-if="menuFor && !menuFor.lockedAt"
        type="button"
        class="menu-row danger"
        @click="startConfirm('lock')"
      >
        Lock account
      </button>
      <button
        v-if="menuFor?.lockedAt"
        type="button"
        class="menu-row"
        @click="startConfirm('unlock')"
      >
        Unlock account
      </button>
      <button
        type="button"
        class="menu-row"
        @click="startConfirm('password')"
      >
        Reset password
      </button>
    </BottomSheet>

    <BottomSheet
      :open="confirm === 'lock'"
      title="Lock this account?"
      @close="closeConfirm"
    >
      <p
        v-if="actionError"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ actionError }}</span>
      </p>
      <p class="text-sm text-[var(--color-ink-700)]">
        {{ menuFor?.firstName }} {{ menuFor?.lastName }} will not be able to sign in.
        They will see a message to contact an administrator.
      </p>
      <div class="sheet-actions">
        <button
          type="button"
          class="btn-cancel"
          :disabled="busy"
          @click="closeConfirm"
        >
          Cancel
        </button>
        <button
          type="button"
          class="btn-save danger"
          :disabled="busy"
          @click="setLocked(true)"
        >
          {{ busy ? 'Locking…' : 'Lock account' }}
        </button>
      </div>
    </BottomSheet>

    <BottomSheet
      :open="confirm === 'unlock'"
      title="Unlock this account?"
      @close="closeConfirm"
    >
      <p
        v-if="actionError"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ actionError }}</span>
      </p>
      <p class="text-sm text-[var(--color-ink-700)]">
        {{ menuFor?.firstName }} {{ menuFor?.lastName }} will be able to sign in with their current password.
      </p>
      <div class="sheet-actions">
        <button
          type="button"
          class="btn-cancel"
          :disabled="busy"
          @click="closeConfirm"
        >
          Cancel
        </button>
        <button
          type="button"
          class="btn-save"
          :disabled="busy"
          @click="setLocked(false)"
        >
          {{ busy ? 'Unlocking…' : 'Unlock account' }}
        </button>
      </div>
    </BottomSheet>

    <BottomSheet
      :open="confirm === 'password'"
      title="Reset password?"
      @close="closeConfirm"
    >
      <p
        v-if="actionError"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ actionError }}</span>
      </p>
      <p class="text-sm text-[var(--color-ink-700)]">
        A new temporary password will be created for {{ menuFor?.firstName }} {{ menuFor?.lastName }}.
        Their current password will stop working.
      </p>
      <div class="sheet-actions">
        <button
          type="button"
          class="btn-cancel"
          :disabled="busy"
          @click="closeConfirm"
        >
          Cancel
        </button>
        <button
          type="button"
          class="btn-save"
          :disabled="busy"
          @click="resetPassword"
        >
          {{ busy ? 'Resetting…' : 'Reset password' }}
        </button>
      </div>
    </BottomSheet>

    <BottomSheet
      :open="Boolean(issuedPassword)"
      title="Give them this password"
      @close="closePassword"
    >
      <p class="text-sm text-[var(--color-ink-700)]">
        {{ passwordName }} can sign in with this password. It is shown only once.
      </p>
      <p class="driver-temp-password mono">
        {{ issuedPassword }}
      </p>
      <div class="sheet-actions">
        <button
          type="button"
          class="btn-cancel"
          @click="closePassword"
        >
          Done
        </button>
        <button
          type="button"
          class="btn-save"
          @click="copyPassword"
        >
          {{ copyState === 'copied' ? 'Copied' : 'Copy password' }}
        </button>
      </div>
    </BottomSheet>
  </div>
</template>
