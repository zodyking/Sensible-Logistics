<script setup lang="ts">
import { CONTAINER_TYPE_LABELS, EQUIPMENT_TYPE_SHORT, TRIP_KIND_LABELS } from '#shared/utils/domain'
import type { ContainerType, EquipmentType, TripKind } from '#shared/utils/domain'
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
</script>

<template>
  <div class="trip-card">
    <div class="trip-card-head">
      <div class="trip-card-meta">
        <span class="trip-flag line">
          {{ typeLabel }}
        </span>
        <span
          class="trip-flag"
          :class="!isBareChassis && isLoaded ? 'loaded' : 'empty'"
        >
          {{ !isBareChassis && isLoaded ? 'Loaded' : 'Empty' }}
        </span>
      </div>

      <div class="trip-cno">
        <slot name="number">
          {{ titleNumber }}
        </slot>
      </div>

      <div class="trip-facts">
        <div class="trip-fact">
          <small>Length</small>
          <b>{{ !isBareChassis && equipmentType ? EQUIPMENT_TYPE_SHORT[equipmentType] : '—' }}</b>
        </div>
        <div class="trip-fact">
          <small>Chassis</small>
          <b>{{ displayChassis }}</b>
        </div>
        <div class="trip-fact">
          <small>Seal</small>
          <b>{{ !isBareChassis && sealNumber ? sealNumber : '—' }}</b>
        </div>
      </div>
    </div>

    <div class="route-strip">
      <div class="route-point">
        <small>{{ originLabel ?? 'Origin' }}</small>
        <strong>{{ originName ?? 'Not set' }}</strong>
      </div>
      <div
        class="route-arrow"
        aria-hidden="true"
      >
        →
      </div>
      <div class="route-point dest">
        <small>{{ destinationLabel ?? 'Drop-off' }}</small>
        <strong>{{ destinationName ?? 'Choose at drop-off' }}</strong>
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
  </div>
</template>
