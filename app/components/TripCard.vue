<script setup lang="ts">
import { CONTAINER_TYPE_LABELS, EQUIPMENT_TYPE_SHORT } from '#shared/utils/domain'
import type { ContainerType, EquipmentType } from '#shared/utils/domain'
import { formatChassisNumber, formatContainerNumber } from '#shared/utils/iso6346'

const props = defineProps<{
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

const displayContainer = computed(() => {
  const formatted = formatContainerNumber(props.containerNumber || '')
  return formatted || props.containerNumber || '—'
})

const displayChassis = computed(() => {
  if (!props.chassisNumber) return 'None'
  return formatChassisNumber(props.chassisNumber) || props.chassisNumber
})
</script>

<template>
  <div class="trip-card">
    <div class="trip-card-head">
      <div class="trip-card-meta">
        <span class="trip-flag line">
          {{ containerType ? CONTAINER_TYPE_LABELS[containerType] : '—' }}
        </span>
        <span
          class="trip-flag"
          :class="isLoaded ? 'loaded' : 'empty'"
        >
          {{ isLoaded ? 'Loaded' : 'Empty' }}
        </span>
      </div>

      <div class="trip-cno">
        <slot name="number">
          {{ displayContainer }}
        </slot>
      </div>

      <div class="trip-facts">
        <div class="trip-fact">
          <small>Length</small>
          <b>{{ equipmentType ? EQUIPMENT_TYPE_SHORT[equipmentType] : '—' }}</b>
        </div>
        <div class="trip-fact">
          <small>Chassis</small>
          <b>{{ displayChassis }}</b>
        </div>
        <div class="trip-fact">
          <small>Seal</small>
          <b>{{ sealNumber || '—' }}</b>
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
