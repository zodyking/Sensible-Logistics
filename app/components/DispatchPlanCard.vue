<script setup lang="ts">
import {
  CONTAINER_STATUS_LABELS,
  CONTAINER_TYPE_LABELS,
  DISPATCH_TASK_KIND_LABELS,
  DISPATCH_TASK_KINDS,
  EQUIPMENT_TYPE_SHORT,
  type DispatchTaskKind,
} from '#shared/utils/domain'
import { displayContainerNumber, type DispatchCard } from '#shared/utils/dispatch-cards'
import { formatContainerNumber } from '#shared/utils/iso6346'

interface DeskBox {
  id: string
  number: string
  containerType: keyof typeof CONTAINER_TYPE_LABELS | string
  equipmentType: keyof typeof EQUIPMENT_TYPE_SHORT | string
  isLoaded: boolean
  containerStatus: string
  locationId: string
}

interface DeskLocation {
  id: string
  name: string
  type: string
  city: string | null
  state: string | null
  containers: DeskBox[]
}

const card = defineModel<DispatchCard>({ required: true })

const props = defineProps<{
  index: number
  locations: DeskLocation[]
  canMoveUp?: boolean
  canMoveDown?: boolean
}>()

const emit = defineEmits<{
  remove: []
  move: [direction: -1 | 1]
}>()

const boxQuery = ref('')

const selectedLocation = computed(() =>
  props.locations.find(site => site.id === card.value.locationId) ?? null,
)

const filteredBoxes = computed(() => {
  const boxes = selectedLocation.value?.containers ?? []
  const q = boxQuery.value.trim().toLowerCase()
  if (!q) return boxes
  return boxes.filter(box => box.number.toLowerCase().includes(q) || box.containerType.toLowerCase().includes(q))
})

function setLocation(id: string) {
  card.value.locationId = id || null
  const site = props.locations.find(site => site.id === id)
  card.value.locationName = site?.name ?? ''
  if (card.value.containerId && !site?.containers.some(box => box.id === card.value.containerId)) {
    card.value.containerId = null
    card.value.containerNumber = card.value.containerPending ? card.value.containerNumber : ''
  }
}

function setDestination(id: string) {
  card.value.destinationLocationId = id || null
  const site = props.locations.find(site => site.id === id)
  card.value.destinationLocationName = site?.name ?? ''
}

function setKind(kind: DispatchTaskKind) {
  card.value.kind = kind
}

function pickBox(box: DeskBox) {
  card.value.containerId = box.id
  card.value.containerNumber = box.number
  card.value.containerPending = false
}

function setPending(on: boolean) {
  card.value.containerPending = on
  if (on) {
    card.value.containerId = null
  }
}

function equipmentLabel(type: string) {
  return EQUIPMENT_TYPE_SHORT[type as keyof typeof EQUIPMENT_TYPE_SHORT] ?? type
}

function brandLabel(type: string) {
  return CONTAINER_TYPE_LABELS[type as keyof typeof CONTAINER_TYPE_LABELS] ?? type
}
</script>

<template>
  <article class="desk-card">
    <header class="desk-card-head">
      <p class="desk-card-kicker">
        Step {{ index + 1 }}
      </p>
      <div class="desk-card-tools">
        <button
          type="button"
          class="desk-icon-btn"
          :disabled="!canMoveUp"
          aria-label="Move up"
          @click="emit('move', -1)"
        >
          ↑
        </button>
        <button
          type="button"
          class="desk-icon-btn"
          :disabled="!canMoveDown"
          aria-label="Move down"
          @click="emit('move', 1)"
        >
          ↓
        </button>
        <button
          type="button"
          class="desk-icon-btn danger"
          aria-label="Remove task"
          @click="emit('remove')"
        >
          ×
        </button>
      </div>
    </header>

    <div
      class="desk-kinds"
      role="radiogroup"
      aria-label="Work type"
    >
      <button
        v-for="kind in DISPATCH_TASK_KINDS"
        :key="kind"
        type="button"
        role="radio"
        :aria-checked="card.kind === kind"
        :class="{ on: card.kind === kind }"
        @click="setKind(kind)"
      >
        {{ DISPATCH_TASK_KIND_LABELS[kind] }}
      </button>
    </div>

    <div class="desk-grid">
      <label class="field">
        <span>From location</span>
        <select
          class="input"
          :value="card.locationId ?? ''"
          @change="setLocation(($event.target as HTMLSelectElement).value)"
        >
          <option value="">
            Select a location
          </option>
          <option
            v-for="site in locations"
            :key="site.id"
            :value="site.id"
          >
            {{ site.name }}{{ site.containers.length ? ` · ${site.containers.length}` : '' }}
          </option>
        </select>
      </label>

      <label class="field">
        <span>To location</span>
        <select
          class="input"
          :value="card.destinationLocationId ?? ''"
          @change="setDestination(($event.target as HTMLSelectElement).value)"
        >
          <option value="">
            Optional
          </option>
          <option
            v-for="site in locations"
            :key="site.id"
            :value="site.id"
          >
            {{ site.name }}
          </option>
        </select>
      </label>
    </div>

    <div
      class="desk-source"
      role="radiogroup"
      aria-label="Container source"
    >
      <button
        type="button"
        role="radio"
        :aria-checked="!card.containerPending"
        :class="{ on: !card.containerPending }"
        @click="setPending(false)"
      >
        On site
      </button>
      <button
        type="button"
        role="radio"
        :aria-checked="card.containerPending"
        :class="{ on: card.containerPending }"
        @click="setPending(true)"
      >
        Not in system yet
      </button>
    </div>

    <div
      v-if="!card.containerPending"
      class="desk-pool"
    >
      <label
        v-if="selectedLocation?.containers.length"
        class="field"
      >
        <span>Search containers</span>
        <input
          v-model="boxQuery"
          class="input"
          type="search"
          placeholder="Number or brand"
        >
      </label>
      <p
        v-if="!card.locationId"
        class="desk-hint"
      >
        Pick a location to choose a container already on site.
      </p>
      <p
        v-else-if="!selectedLocation?.containers.length"
        class="desk-hint"
      >
        No active containers at this location. Switch to “Not in system yet” if the box is incoming.
      </p>
      <ul
        v-else
        class="desk-boxes"
      >
        <li
          v-for="box in filteredBoxes"
          :key="box.id"
        >
          <button
            type="button"
            class="desk-box"
            :class="{ on: card.containerId === box.id }"
            @click="pickBox(box)"
          >
            <b class="mono">{{ formatContainerNumber(box.number) || box.number }}</b>
            <span>
              {{ equipmentLabel(box.equipmentType) }}
              · {{ brandLabel(box.containerType) }}
              · {{ box.isLoaded ? 'Loaded' : 'Empty' }}
              · {{ CONTAINER_STATUS_LABELS[box.containerStatus as keyof typeof CONTAINER_STATUS_LABELS] || box.containerStatus }}
            </span>
          </button>
        </li>
      </ul>
      <p
        v-if="card.containerId"
        class="desk-picked"
      >
        Selected {{ displayContainerNumber(card.containerNumber) }}
      </p>
    </div>

    <label
      v-else
      class="field"
    >
      <span>Container number</span>
      <ContainerNumberInput v-model="card.containerNumber" />
      <small class="field-hint">Incoming or not yet in the pool. The driver still sees the number.</small>
    </label>

    <label class="field">
      <span>Notes</span>
      <textarea
        v-model="card.notes"
        class="input desk-notes"
        rows="2"
        maxlength="2000"
        placeholder="Appointment, chassis, gate, special instructions"
      />
    </label>
  </article>
</template>
