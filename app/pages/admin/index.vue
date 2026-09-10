<script setup lang="ts">
import type { EventType, ActivePoolState, ContainerStatus, ContainerType, EquipmentType, LocationType } from '#shared/utils/domain'
import {
  CONTAINER_TYPE_LABELS,
  EQUIPMENT_TYPE_SHORT,
  LOCATION_TYPE_LABELS,
  containerSituation,
} from '#shared/utils/domain'
import { formatChassisNumber, formatContainerNumber } from '#shared/utils/iso6346'
import { visibleTimelineEntries } from '#shared/utils/timeline'
import type { ViewerDocument } from '~/utils/documents'

definePageMeta({ layout: 'admin' })
useHead({ title: 'Board' })

interface DispatchBox {
  id: string
  number: string
  containerType: ContainerType
  equipmentType: EquipmentType
  isLoaded: boolean
  containerStatus: ContainerStatus
  activePoolState: ActivePoolState
  sealNumber: string | null
  chassisNumber: string | null
  droppedOffAt: string | null
}

interface DispatchSite {
  id: string
  name: string
  type: LocationType
  addressLine1: string | null
  city: string | null
  state: string | null
  latitude: number | null
  longitude: number | null
  occupancy: number
  containers: DispatchBox[]
}

interface InspectedContainer {
  container: {
    id: string
    number: string
    containerType: ContainerType
    equipmentType: EquipmentType
    isLoaded: boolean
    containerStatus: ContainerStatus
    activePoolState: ActivePoolState
    sealNumber: string | null
  }
  currentLocation: { id: string, name: string, type: LocationType } | null
  currentChassis: { id: string, number: string } | null
  currentDriver: { id: string, name: string } | null
  documents: ViewerDocument[]
  timeline: Array<{
    id: string
    eventType: EventType
    occurredAt: string
    createdAt?: string
    locationName?: string | null
    chassisNumber?: string | null
    actorFirstName?: string | null
    actorLastName?: string | null
  }>
}

const { data, error } = await useFetch('/api/admin/dispatch')

const selectedId = ref<string | null>(null)
const inspectedId = ref<string | null>(null)
const inspected = ref<InspectedContainer | null>(null)
const inspectPending = ref(false)
const inspectError = ref('')
const poolQuery = ref('')

const locations = computed(() => (data.value?.locations ?? []) as DispatchSite[])
const selected = computed(() => locations.value.find(site => site.id === selectedId.value) ?? null)

const filteredPool = computed(() => {
  const q = poolQuery.value.trim().toLowerCase()
  const boxes = selected.value?.containers ?? []
  if (!q) return boxes
  return boxes.filter((box) => {
    return [
      box.number,
      CONTAINER_TYPE_LABELS[box.containerType],
      EQUIPMENT_TYPE_SHORT[box.equipmentType],
      box.chassisNumber,
    ].some(value => value?.toLowerCase().includes(q))
  })
})

watch(locations, (sites) => {
  if (selectedId.value && sites.some(site => site.id === selectedId.value)) return
  const withBoxes = sites.find(site => site.occupancy > 0 && site.latitude != null)
  selectedId.value = withBoxes?.id ?? sites[0]?.id ?? null
}, { immediate: true })

watch(selectedId, () => {
  inspectedId.value = null
  inspected.value = null
  inspectError.value = ''
})

function selectSite(id: string) {
  selectedId.value = id
}

function placeLine(site: DispatchSite) {
  return [site.addressLine1, [site.city, site.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
}

function situationFor(box: Pick<DispatchBox, 'containerStatus' | 'activePoolState'>) {
  return containerSituation(box)
}

async function openInspect(box: DispatchBox) {
  if (inspectPending.value && inspectedId.value === box.id) return
  inspectedId.value = box.id
  inspectError.value = ''
  inspectPending.value = true
  try {
    inspected.value = await $fetch<InspectedContainer>(`/api/containers/${box.id}`)
  }
  catch (err) {
    inspected.value = null
    inspectError.value = apiErrorMessage(err, 'Could not load this container.')
  }
  finally {
    inspectPending.value = false
  }
}

function closeInspect() {
  inspectedId.value = null
  inspected.value = null
  inspectError.value = ''
}

const inspectSituation = computed(() => {
  const c = inspected.value?.container
  if (!c) return null
  return containerSituation(c)
})

const inspectTimeline = computed(() => visibleTimelineEntries(inspected.value?.timeline ?? []).slice(0, 5))

const selectedBox = computed(() => {
  if (!inspectedId.value || !selected.value) return null
  return selected.value.containers.find(box => box.id === inspectedId.value) ?? null
})
</script>

<template>
  <section class="dispatch-board">
    <div class="dispatch-map-col">
      <p
        v-if="error"
        class="dispatch-map-msg err"
        role="alert"
      >
        {{ apiErrorMessage(error, 'Could not load the dispatch board.') }}
      </p>
      <ClientOnly v-else>
        <DispatchBoardMap
          :locations="locations"
          :selected-id="selectedId"
          @select="selectSite"
        />
        <template #fallback>
          <p class="dispatch-map-msg">
            Loading map…
          </p>
        </template>
      </ClientOnly>
    </div>

    <aside
      class="dispatch-panel"
      :aria-label="inspected ? 'Container detail' : 'Location detail'"
    >
      <template v-if="inspectedId">
        <button
          type="button"
          class="dispatch-back"
          @click="closeInspect"
        >
          ‹ {{ selected?.name || 'Location' }}
        </button>

        <p
          v-if="inspectError"
          class="banner err"
          role="alert"
        >
          {{ inspectError }}
        </p>

        <div
          v-else-if="inspectPending && !inspected"
          class="dispatch-empty"
          role="status"
        >
          Loading container…
        </div>

        <template v-else-if="inspected">
          <header class="dispatch-panel-head">
            <p class="eyebrow">
              Container
            </p>
            <h2 class="mono">
              {{ formatContainerNumber(inspected.container.number) || inspected.container.number }}
            </h2>
            <div class="dispatch-inspect-chips">
              <StatusChip
                v-if="inspectSituation"
                :variant="inspectSituation.variant"
                :label="inspectSituation.label"
              />
              <StatusChip
                plain
                variant="idle"
                :label="EQUIPMENT_TYPE_SHORT[inspected.container.equipmentType]"
              />
              <StatusChip
                :variant="inspected.container.isLoaded ? 'ok' : 'idle'"
                :label="inspected.container.isLoaded ? 'Loaded' : 'Empty'"
              />
              <StatusChip
                plain
                variant="idle"
                :label="CONTAINER_TYPE_LABELS[inspected.container.containerType]"
              />
            </div>
            <p
              v-if="inspected.currentLocation"
              class="dispatch-panel-place"
            >
              {{ inspected.currentLocation.name }}
              <template v-if="selected && placeLine(selected)">
                · {{ placeLine(selected) }}
              </template>
            </p>
            <p
              v-if="inspected.currentDriver"
              class="dispatch-panel-place"
            >
              With {{ inspected.currentDriver.name }}
            </p>
            <p
              v-if="inspected.currentChassis"
              class="dispatch-panel-place"
            >
              Chassis {{ formatChassisNumber(inspected.currentChassis.number) || inspected.currentChassis.number }}
            </p>
            <p
              v-if="inspected.container.isLoaded && inspected.container.sealNumber"
              class="dispatch-panel-place"
            >
              Seal {{ inspected.container.sealNumber }}
            </p>
            <p
              v-if="selectedBox?.droppedOffAt"
              class="dispatch-panel-count"
            >
              Dropped off {{ formatDateTime(selectedBox.droppedOffAt) }}
            </p>
          </header>

          <section class="dispatch-inspect-section">
            <h3>Photos & documents</h3>
            <DocumentCarousel
              :documents="inspected.documents"
              empty-title="No photos or documents"
              empty-description="Container photos and paperwork will appear here."
            />
          </section>

          <section
            v-if="inspectTimeline.length"
            class="dispatch-inspect-section"
          >
            <h3>Recent movement</h3>
            <EventTimeline
              subject="container"
              :entries="inspectTimeline"
            />
          </section>

          <NuxtLink
            class="btn-primary-action dispatch-full-record"
            :to="`/containers/${inspected.container.id}`"
          >
            Open full record
          </NuxtLink>
        </template>
      </template>

      <template v-else-if="selected">
        <header class="dispatch-panel-head">
          <p class="eyebrow">
            {{ LOCATION_TYPE_LABELS[selected.type] }}
          </p>
          <h2>{{ selected.name }}</h2>
          <p
            v-if="placeLine(selected)"
            class="dispatch-panel-place"
          >
            {{ placeLine(selected) }}
          </p>
          <p class="dispatch-panel-count">
            {{ selected.occupancy }} {{ selected.occupancy === 1 ? 'container' : 'containers' }} on site
          </p>
        </header>

        <label class="dispatch-search">
          <span class="sr-only">Search containers</span>
          <input
            v-model="poolQuery"
            class="input"
            type="search"
            placeholder="Search number, brand, size…"
          >
        </label>

        <div
          v-if="!filteredPool.length"
          class="dispatch-empty"
        >
          {{ selected.occupancy ? 'No containers match that search.' : 'No active containers at this location.' }}
        </div>

        <ul
          v-else
          class="dispatch-pool"
        >
          <li
            v-for="box in filteredPool"
            :key="box.id"
          >
            <button
              type="button"
              class="dispatch-box"
              @click="openInspect(box)"
            >
              <div class="dispatch-box-top">
                <b class="mono">{{ formatContainerNumber(box.number) || box.number }}</b>
                <StatusChip
                  :variant="situationFor(box).variant"
                  :label="situationFor(box).label"
                />
              </div>
              <p>
                {{ EQUIPMENT_TYPE_SHORT[box.equipmentType] }}
                · {{ CONTAINER_TYPE_LABELS[box.containerType] }}
                · {{ box.isLoaded ? 'Loaded' : 'Empty' }}
              </p>
              <p>
                Dropped off {{ formatDateTime(box.droppedOffAt) }}
                <template v-if="box.chassisNumber">
                  · Chassis {{ box.chassisNumber }}
                </template>
              </p>
            </button>
          </li>
        </ul>
        <p
          v-if="selected.occupancy"
          class="dispatch-hint"
        >
          Tap a container for its record, photos, and documents.
        </p>
      </template>
      <EmptyState
        v-else
        glyph="◫"
        title="No locations yet"
        description="Add a yard or customer with a map pin, then the pool shows up here."
      />
    </aside>
  </section>
</template>
