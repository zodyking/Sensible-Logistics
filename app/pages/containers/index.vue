<script setup lang="ts">
import { ACTIVE_POOL_CHIP, ACTIVE_POOL_LABELS, EQUIPMENT_TYPE_LABELS } from '#shared/utils/domain'

useHead({ title: 'Containers' })

const route = useRoute()
const search = ref('')
const debounced = ref('')
const scope = ref<'active' | 'all'>('active')

let debounceTimer: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounced.value = value
  }, 300)
})

const { data, status, error } = await useFetch('/api/containers', {
  query: computed(() => ({
    q: debounced.value || undefined,
    scope: scope.value,
    locationId: typeof route.query.locationId === 'string' ? route.query.locationId : undefined,
    limit: 50,
  })),
})
</script>

<template>
  <section class="d-page">
    <PageHeader
      eyebrow="Inventory"
      title="Containers"
    />

    <div class="searchbar">
      <span aria-hidden="true">⌕</span>
      <input
        v-model="search"
        type="search"
        placeholder="Container, seal, booking, BOL…"
        aria-label="Search containers"
      >
    </div>

    <div
      class="mb-4 flex gap-2"
      role="group"
      aria-label="Filter by pool scope"
    >
      <button
        type="button"
        class="fchip"
        :class="{ on: scope === 'active' }"
        :aria-pressed="scope === 'active'"
        @click="scope = 'active'"
      >
        Active pool
      </button>
      <button
        type="button"
        class="fchip"
        :class="{ on: scope === 'all' }"
        :aria-pressed="scope === 'all'"
        @click="scope = 'all'"
      >
        All history
      </button>
    </div>

    <div
      v-if="status === 'pending'"
      class="card p-6 text-center text-sm text-[var(--color-ink-500)]"
      role="status"
    >
      Searching…
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
      <p
        class="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-500)]"
        role="status"
      >
        {{ data.total }} container{{ data.total === 1 ? '' : 's' }}
      </p>

      <div class="card rowlist">
        <NuxtLink
          v-for="item in data.items"
          :key="item.id"
          :to="`/containers/${item.id}`"
          class="row"
        >
          <span
            class="row-ico"
            aria-hidden="true"
          >▦</span>
          <span class="row-main">
            <b class="mono">{{ item.number }}</b>
            <small>
              {{ EQUIPMENT_TYPE_LABELS[item.equipmentType] }} ·
              {{ item.isLoaded ? 'Loaded' : 'Empty' }} ·
              {{ item.locationName ?? (item.driverName ? `With ${item.driverName}` : 'Location unknown') }}
            </small>
          </span>
          <span class="row-end flex flex-col items-end gap-1">
            <StatusChip
              :variant="ACTIVE_POOL_CHIP[item.activePoolState]"
              :label="ACTIVE_POOL_LABELS[item.activePoolState]"
            />
            <StatusChip
              v-if="!item.checkDigitValid"
              variant="warn"
              label="Check digit"
            />
          </span>
        </NuxtLink>
      </div>
    </template>

    <EmptyState
      v-else
      title="No containers found"
      :description="debounced ? `Nothing matches “${debounced}”.` : 'Containers enter the pool when you start a pickup.'"
    >
      <NuxtLink
        to="/pickups/new"
        class="btn-ghost"
      >
        Start a pickup
      </NuxtLink>
    </EmptyState>
  </section>
</template>
