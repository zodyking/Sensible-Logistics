<script setup lang="ts">
import {
  CONTAINER_TYPE_LABELS,
  EQUIPMENT_TYPE_SHORT,
  TRIP_KIND_LABELS,
  TRIP_STATUS_CHIP,
  TRIP_STATUS_LABELS,
} from '#shared/utils/domain'
import type { ContainerType, EquipmentType, TripKind, TripStatus } from '#shared/utils/domain'
import { formatChassisNumber, formatContainerNumber } from '#shared/utils/iso6346'

const props = defineProps<{
  tripKind?: TripKind | null
  containerType?: ContainerType | null
  isLoaded?: boolean | null
  containerNumber?: string | null
  equipmentType?: EquipmentType | null
  chassisNumber?: string | null
  sealNumber?: string | null
  originName?: string | null
  destinationName?: string | null
  originLabel?: string
  destinationLabel?: string
  canChangeDropoff?: boolean
  status?: TripStatus | null
}>()

const emit = defineEmits<{ changeDropoff: [] }>()

const isBareChassis = computed(() =>
  props.tripKind === 'BARE_CHASSIS' || (!props.containerNumber && Boolean(props.chassisNumber)),
)

const displayContainer = computed(() => {
  const formatted = formatContainerNumber(props.containerNumber || '')
  return formatted || props.containerNumber || '—'
})

const displayChassis = computed(() => {
  if (!props.chassisNumber) return 'None'
  return formatChassisNumber(props.chassisNumber) || props.chassisNumber
})

const titleNumber = computed(() => isBareChassis.value ? displayChassis.value : displayContainer.value)

const typeLabel = computed(() => {
  if (isBareChassis.value) return TRIP_KIND_LABELS.BARE_CHASSIS
  return props.containerType ? CONTAINER_TYPE_LABELS[props.containerType] : '—'
})

const originDisplay = computed(() => props.originName?.trim() || 'Not set')
const destinationDisplay = computed(() => props.destinationName?.trim() || 'Choose at drop-off')
const loadLabel = computed(() => !isBareChassis.value && props.isLoaded ? 'Loaded' : 'Empty')
</script>

<template>
  <article class="trip-card">
    <div class="trip-card-head">
      <div
        v-if="status"
        class="trip-card-meta"
      >
        <StatusChip
          :variant="TRIP_STATUS_CHIP[status]"
          :label="TRIP_STATUS_LABELS[status]"
        />
      </div>

      <div class="trip-cno">
        <slot name="number">
          <CopyMarking
            v-if="isBareChassis && chassisNumber"
            kind="chassis"
            :value="chassisNumber"
            :display="displayChassis"
          />
          <CopyMarking
            v-else-if="containerNumber"
            kind="container"
            :value="containerNumber"
            :display="displayContainer"
          />
          <template v-else>
            {{ titleNumber }}
          </template>
        </slot>
      </div>

      <div class="trip-facts">
        <div class="trip-fact">
          <small>Length</small>
          <b>{{ !isBareChassis && equipmentType ? EQUIPMENT_TYPE_SHORT[equipmentType] : '—' }}</b>
        </div>
        <div class="trip-fact">
          <small>Chassis</small>
          <CopyMarking
            v-if="chassisNumber"
            kind="chassis"
            :value="chassisNumber"
            :display="displayChassis"
          />
          <b v-else>{{ displayChassis }}</b>
        </div>
        <div class="trip-fact">
          <small>Seal</small>
          <CopyMarking
            v-if="!isBareChassis && sealNumber"
            kind="seal"
            :value="sealNumber"
          />
          <b v-else>—</b>
        </div>
      </div>

      <div class="trip-facts trip-facts-split">
        <div class="trip-fact">
          <small>Type</small>
          <b>{{ typeLabel }}</b>
        </div>
        <div class="trip-fact trip-fact-end">
          <small>Load</small>
          <b>{{ loadLabel }}</b>
        </div>
      </div>
    </div>

    <div class="route-strip">
      <div class="route-point">
        <strong>{{ originDisplay }}</strong>
        <small>{{ originLabel ?? 'Pickup' }}</small>
      </div>
      <div
        class="route-track"
        aria-hidden="true"
      >
        <i class="route-dot on" />
        <span class="route-line" />
        <span class="route-chevr">›</span>
        <span class="route-line" />
        <i
          class="route-dot"
          :class="{ on: Boolean(destinationName) }"
        />
      </div>
      <div class="route-point dest">
        <strong>{{ destinationDisplay }}</strong>
        <small>{{ destinationLabel ?? 'Drop-off' }}</small>
        <button
          v-if="canChangeDropoff"
          type="button"
          class="route-change"
          @click="emit('changeDropoff')"
        >
          Change
        </button>
      </div>
    </div>
  </article>
</template>
