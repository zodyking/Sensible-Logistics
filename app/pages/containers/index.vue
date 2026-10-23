<script setup lang="ts">
import {
  CONTAINER_TYPE_LABELS,
  pickupEquipmentSizeLabel,
} from '#shared/utils/domain'
import type { ContainerType, EquipmentType, LocationType } from '#shared/utils/domain'
import { formatChassisNumber, formatContainerNumber } from '#shared/utils/iso6346'

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

type LocationRow = {
  id: string
  name: string
  type: LocationType
  addressLine1: string | null
  city: string | null
  occupancy: number
  isUncategorized?: boolean
  matchedNumbers?: string[]
}

type EquipmentHit = {
  kind: 'CONTAINER' | 'CHASSIS'
  id: string
  number: string
  locationId: string | null
  locationName: string | null
  containerType: ContainerType | null
  equipmentType: EquipmentType | null
  isLoaded: boolean | null
}

const { data, status, error } = await useFetch('/api/locations', {
  query: computed(() => ({
    q: debounced.value || undefined,
    limit: 100,
    includeUncategorized: '1',
  })),
})

const locations = computed(() => (data.value?.items ?? []) as LocationRow[])
const equipment = computed(() => (data.value?.equipment ?? []) as EquipmentHit[])
const hasQuery = computed(() => Boolean(debounced.value.trim()))
const hasResults = computed(() => locations.value.length > 0 || equipment.value.length > 0)

function addressLine(item: { addressLine1: string | null, city: string | null, isUncategorized?: boolean }) {
  if (item.isUncategorized) return 'Holding site for equipment from deleted locations'
  return [item.addressLine1, item.city].filter(Boolean).join(' · ') || '—'
}

function equipmentLabel(item: EquipmentHit) {
  if (item.kind === 'CHASSIS') return 'Bare chassis'
  const parts = [
    item.containerType ? CONTAINER_TYPE_LABELS[item.containerType] : null,
    item.equipmentType ? pickupEquipmentSizeLabel(item.equipmentType) : null,
    item.isLoaded ? 'Loaded' : 'Empty',
    item.locationName,
  ].filter(Boolean)
  return parts.join(' · ')
}

function openEquipment(item: EquipmentHit) {
  if (item.kind === 'CHASSIS') {
    void navigateTo(`/chassis/${item.id}`)
    return
  }
  void navigateTo(`/containers/${item.id}`)
}

function matchedHint(item: LocationRow) {
  const numbers = item.matchedNumbers ?? []
  if (!numbers.length) return ''
  const shown = numbers.slice(0, 2).map(value => formatContainerNumber(value) || formatChassisNumber(value) || value)
  return numbers.length > 2 ? `Has ${shown.join(', ')} +${numbers.length - 2}` : `Has ${shown.join(', ')}`
}
</script>

<template>
  <section class="d-page">
    <span class="eyebrow">Inventory</span>
    <h1 class="d-title">
      Locations
    </h1>
    <div class="searchbar">
      ⌕
      <input
        v-model="search"
        type="search"
        placeholder="Search location, customer, container, or chassis…"
        aria-label="Search locations, containers, and chassis"
      >
    </div>

    <NuxtLink
      to="/locations/new"
      class="btn-dark mb-4 w-full"
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

    <template v-else-if="hasResults">
      <template v-if="equipment.length">
        <span class="wiz-label">Equipment</span>
        <div class="wiz-group">
          <button
            v-for="item in equipment"
            :key="`${item.kind}-${item.id}`"
            type="button"
            class="wiz-pick"
            @click="openEquipment(item)"
          >
            <span class="wiz-pick-main">
              <b class="font-mono">{{
                item.kind === 'CHASSIS'
                  ? (formatChassisNumber(item.number) || item.number)
                  : (formatContainerNumber(item.number) || item.number)
              }}</b>
              <small>{{ equipmentLabel(item) }}</small>
            </span>
            <span
              class="wiz-chev"
              aria-hidden="true"
            >›</span>
          </button>
        </div>
      </template>
      <LocationGroupedList
        v-if="locations.length"
        :items="locations"
      >
        <template #default="{ item }">
          <button
            type="button"
            class="wiz-pick"
            @click="navigateTo(`/locations/${item.id}`)"
          >
            <span
              class="wiz-pick-ico"
              aria-hidden="true"
            >
              <LocationIcon :name="item.type" />
            </span>
            <span class="wiz-pick-main">
              <b>{{ item.name }}</b>
              <small>{{ addressLine(item) }}</small>
              <small
                v-if="matchedHint(item)"
                class="block"
              >
                {{ matchedHint(item) }}
              </small>
            </span>
            <span class="wiz-pick-end">
              <small>{{ item.occupancy }} on site</small>
              <span
                class="wiz-chev"
                aria-hidden="true"
              >›</span>
            </span>
          </button>
        </template>
      </LocationGroupedList>
    </template>

    <EmptyState
      v-else
      glyph="⌂"
      :title="hasQuery ? 'Nothing matches' : 'No locations yet'"
      :description="hasQuery
        ? 'No location, container, or chassis matches that search.'
        : 'Add a yard, terminal, or customer.'"
    >
      <NuxtLink
        v-if="!hasQuery"
        to="/locations/new"
        class="btn-ghost"
      >
        Add a location
      </NuxtLink>
    </EmptyState>
  </section>
</template>
