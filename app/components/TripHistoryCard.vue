<script setup lang="ts">
import { TRIP_STATUS_CHIP, TRIP_STATUS_LABELS } from '#shared/utils/domain'
import type { TripStatus } from '#shared/utils/domain'
import { formatChassisNumber, formatContainerNumber } from '#shared/utils/iso6346'

const props = defineProps<{
  to: string
  status: TripStatus
  reference: string
  originName?: string | null
  destinationName?: string | null
  pickedUpAt?: string | Date | null
  droppedOffAt?: string | Date | null
  containerNumber?: string | null
  chassisNumber?: string | null
}>()

const equipmentLabel = computed(() => {
  if (props.containerNumber) {
    return formatContainerNumber(props.containerNumber) || props.containerNumber
  }
  if (props.chassisNumber) {
    return formatChassisNumber(props.chassisNumber) || props.chassisNumber
  }
  return props.reference
})

const pickupLabel = computed(() => {
  if (props.pickedUpAt) return formatTime(props.pickedUpAt)
  return '—'
})

const dropoffLabel = computed(() => {
  if (props.droppedOffAt) return formatTime(props.droppedOffAt)
  if (['CANCELLED', 'EXCEPTION'].includes(props.status)) return '—'
  return 'Open'
})
</script>

<template>
  <NuxtLink
    :to="to"
    class="trip-hist"
  >
    <div class="trip-hist-route">
      <div class="trip-hist-point">
        <small>Origin</small>
        <strong>{{ originName || 'Not set' }}</strong>
      </div>
      <span
        class="trip-hist-arrow"
        aria-hidden="true"
      >→</span>
      <div class="trip-hist-point dest">
        <small>Drop-off</small>
        <strong>{{ destinationName || 'Open dest' }}</strong>
      </div>
    </div>

    <div class="trip-hist-times">
      <div>
        <small>Picked up</small>
        <b>{{ pickupLabel }}</b>
      </div>
      <div class="dest">
        <small>Dropped off</small>
        <b>{{ dropoffLabel }}</b>
      </div>
    </div>

    <div class="trip-hist-foot">
      <span class="mono">{{ equipmentLabel }}</span>
      <StatusChip
        :variant="TRIP_STATUS_CHIP[status]"
        :label="TRIP_STATUS_LABELS[status]"
      />
    </div>
  </NuxtLink>
</template>
