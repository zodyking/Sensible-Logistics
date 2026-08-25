<script setup lang="ts">
import type { ActivePoolState, ContainerType } from '#shared/utils/domain'
import {
  ACTIVE_POOL_CHIP,
  ACTIVE_POOL_LABELS,
  ACTIVE_POOL_STATES,
  CONTAINER_TYPE_LABELS,
  CONTAINER_TYPES,
  EQUIPMENT_TYPE_LABELS,
} from '#shared/utils/domain'

definePageMeta({ layout: 'admin' })
useHead({ title: 'Containers · Management' })

/* --- Filters ------------------------------------------------------ */
const searchInput = ref('')
const q = ref('')
const state = ref<ActivePoolState | ''>('')
const type = ref<ContainerType | ''>('')
const loaded = ref<'' | 'true' | 'false'>('')
const scope = ref<'active' | 'all'>('active')
const limit = ref(50)
const offset = ref(0)

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

watch([q, state, type, loaded, scope], () => {
  offset.value = 0
})

function setState(next: ActivePoolState | '') {
  state.value = next
  // Released containers only exist in history, so widen the scope for them.
  if (next === 'INACTIVE') scope.value = 'all'
}

function clearFilters() {
  searchInput.value = ''
  q.value = ''
  state.value = ''
  type.value = ''
  loaded.value = ''
  scope.value = 'active'
}

const { data, status, error, refresh } = await useFetch('/api/containers', {
  query: computed(() => ({
    q: q.value || undefined,
    state: state.value || undefined,
    type: type.value || undefined,
    loaded: loaded.value || undefined,
    scope: scope.value,
    limit: limit.value,
    offset: offset.value,
  })),
})

const rows = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)

/* --- Derived counts (scoped to the returned page) ----------------- */
const loadedOnPage = computed(() => rows.value.filter(row => row.isLoaded).length)
const custodyOnPage = computed(() => rows.value.filter(row => row.activePoolState === 'DRIVER_CUSTODY').length)
const attentionOnPage = computed(
  () => rows.value.filter(row => row.checkDigitValid === false || row.isDamaged || row.customsHold).length,
)

/* --- Pagination ---------------------------------------------------- */
const rangeStart = computed(() => (rows.value.length === 0 ? 0 : offset.value + 1))
const rangeEnd = computed(() => offset.value + rows.value.length)
const hasPrevious = computed(() => offset.value > 0)
const hasNext = computed(() => offset.value + limit.value < total.value)

function previousPage() {
  offset.value = Math.max(0, offset.value - limit.value)
}

function nextPage() {
  if (hasNext.value) offset.value = offset.value + limit.value
}
</script>

<template>
  <div>
    <div class="a-head">
      <div>
        <span class="eyebrow">Operations</span>
        <h1>Containers</h1>
      </div>
      <p class="text-sm text-[var(--color-ink-500)]">
        Search the pool, inspect custody, and jump into a container for corrections.
      </p>
    </div>

    <div class="a-toolbar">
      <label class="searchbar">
        <span class="sr-only">Search containers</span>
        <span aria-hidden="true">⌕</span>
        <input
          v-model="searchInput"
          type="search"
          placeholder="Container number, seal, booking, BOL…"
        >
      </label>

      <label
        class="sr-only"
        for="container-type-filter"
      >Container type</label>
      <select
        id="container-type-filter"
        v-model="type"
        class="select w-auto"
      >
        <option value="">
          All types
        </option>
        <option
          v-for="value in CONTAINER_TYPES"
          :key="value"
          :value="value"
        >
          {{ CONTAINER_TYPE_LABELS[value] }}
        </option>
      </select>

      <label
        class="sr-only"
        for="container-loaded-filter"
      >Cargo state</label>
      <select
        id="container-loaded-filter"
        v-model="loaded"
        class="select w-auto"
      >
        <option value="">
          Loaded & empty
        </option>
        <option value="true">
          Loaded
        </option>
        <option value="false">
          Empty
        </option>
      </select>
    </div>

    <div
      class="a-toolbar"
      role="group"
      aria-label="Pool state filter"
    >
      <button
        class="fchip min-h-11"
        :class="{ on: state === '' }"
        :aria-pressed="state === ''"
        @click="setState('')"
      >
        All states
      </button>
      <button
        v-for="value in ACTIVE_POOL_STATES"
        :key="value"
        class="fchip min-h-11"
        :class="{ on: state === value }"
        :aria-pressed="state === value"
        @click="setState(value)"
      >
        {{ ACTIVE_POOL_LABELS[value] }}
      </button>
    </div>

    <div
      class="a-toolbar"
      role="group"
      aria-label="History scope"
    >
      <button
        class="fchip min-h-11"
        :class="{ on: scope === 'active' }"
        :aria-pressed="scope === 'active'"
        @click="scope = 'active'"
      >
        Active pool
      </button>
      <button
        class="fchip min-h-11"
        :class="{ on: scope === 'all' }"
        :aria-pressed="scope === 'all'"
        @click="scope = 'all'"
      >
        All history
      </button>
    </div>

    <div class="a-stats">
      <div class="a-stat">
        <small>Total matching</small>
        <b>{{ total }}</b>
      </div>
      <div class="a-stat">
        <small>Loaded · this page</small>
        <b>{{ loadedOnPage }}</b>
      </div>
      <div class="a-stat">
        <small>Driver custody · this page</small>
        <b>{{ custodyOnPage }}</b>
      </div>
      <div class="a-stat">
        <small>Needs attention · this page</small>
        <b>{{ attentionOnPage }}</b>
      </div>
    </div>

    <div
      v-if="status === 'pending'"
      class="card p-5"
      role="status"
    >
      <span class="sr-only">Loading containers…</span>
      <div
        class="space-y-3"
        aria-hidden="true"
      >
        <div class="h-4 w-1/3 animate-pulse rounded bg-[var(--color-paper-100)]" />
        <div class="h-4 w-2/3 animate-pulse rounded bg-[var(--color-paper-100)]" />
        <div class="h-4 w-1/2 animate-pulse rounded bg-[var(--color-paper-100)]" />
        <div class="h-4 w-3/5 animate-pulse rounded bg-[var(--color-paper-100)]" />
      </div>
    </div>

    <div
      v-else-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>
        <b>Could not load containers</b>
        {{ apiErrorMessage(error) }}
      </span>
      <button
        class="btn-ghost ml-auto"
        @click="refresh()"
      >
        Try again
      </button>
    </div>

    <template v-else-if="rows.length">
      <div class="table-wrap">
        <table class="dtable">
          <caption class="sr-only">
            Containers matching the current filters
          </caption>
          <thead>
            <tr>
              <th scope="col">
                Container
              </th>
              <th scope="col">
                Type
              </th>
              <th scope="col">
                Equipment
              </th>
              <th scope="col">
                Cargo
              </th>
              <th scope="col">
                Pool state
              </th>
              <th scope="col">
                Location
              </th>
              <th scope="col">
                Driver
              </th>
              <th scope="col">
                Last activity
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
                  :to="`/containers/${row.id}`"
                  class="mono inline-flex min-h-11 items-center"
                >
                  {{ row.number }}
                </NuxtLink>
                <div
                  v-if="row.checkDigitValid === false || row.isDamaged || row.customsHold"
                  class="mt-1 flex flex-wrap gap-1"
                >
                  <StatusChip
                    v-if="row.checkDigitValid === false"
                    variant="warn"
                    label="Check digit"
                  />
                  <StatusChip
                    v-if="row.isDamaged"
                    variant="err"
                    label="Damaged"
                  />
                  <StatusChip
                    v-if="row.customsHold"
                    variant="warn"
                    label="Customs hold"
                  />
                </div>
              </td>
              <td>{{ CONTAINER_TYPE_LABELS[row.containerType] }}</td>
              <td>{{ EQUIPMENT_TYPE_LABELS[row.equipmentType] }}</td>
              <td>{{ row.isLoaded ? 'Loaded' : 'Empty' }}</td>
              <td>
                <StatusChip
                  :variant="ACTIVE_POOL_CHIP[row.activePoolState]"
                  :label="ACTIVE_POOL_LABELS[row.activePoolState]"
                />
              </td>
              <td>{{ row.locationName ?? '—' }}</td>
              <td>{{ row.driverName ?? '—' }}</td>
              <td>{{ formatRelative(row.lastActivityAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-3">
        <p
          class="text-sm text-[var(--color-ink-500)]"
          role="status"
        >
          Showing {{ rangeStart }}–{{ rangeEnd }} of {{ total }}
        </p>
        <div class="ml-auto flex gap-2">
          <button
            class="btn-ghost"
            :disabled="!hasPrevious"
            @click="previousPage"
          >
            Previous
          </button>
          <button
            class="btn-ghost"
            :disabled="!hasNext"
            @click="nextPage"
          >
            Next
          </button>
        </div>
      </div>
    </template>

    <EmptyState
      v-else
      glyph="▦"
      title="No containers match"
      description="Try a different search or widen the filters — released containers live under All history."
    >
      <button
        class="btn-ghost"
        @click="clearFilters"
      >
        Clear filters
      </button>
    </EmptyState>
  </div>
</template>
