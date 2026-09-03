<script setup lang="ts">
import {
  CONTAINER_TYPE_LABELS,
  TRIP_KIND_LABELS,
  TRIP_STATUS_CHIP,
} from '#shared/utils/domain'
import type { ContainerType, TripKind, TripStatus } from '#shared/utils/domain'
import { formatChassisNumber, formatContainerNumber } from '#shared/utils/iso6346'

const props = defineProps<{
  id: string
  status: TripStatus
  kind?: TripKind | null
  containerNumber?: string | null
  containerType?: ContainerType | null
  chassisNumber?: string | null
  reference: string
  originName?: string | null
  destinationName?: string | null
  pickedUpAt?: string | null
  droppedOffAt?: string | null
  isLoaded?: boolean | null
  createdAt: string
}>()

const title = computed(() => {
  if (props.containerNumber) {
    return formatContainerNumber(props.containerNumber) || props.containerNumber
  }
  if (props.chassisNumber) {
    return formatChassisNumber(props.chassisNumber) || props.chassisNumber
  }
  return props.reference
})

const isBareChassis = computed(() =>
  props.kind === 'BARE_CHASSIS' || (!props.containerNumber && Boolean(props.chassisNumber)),
)

const origin = computed(() => props.originName?.trim() || 'No origin')
const destination = computed(() => props.destinationName?.trim() || 'Not set')

const metaLine = computed(() => {
  const bits: string[] = []
  if (isBareChassis.value) {
    bits.push(TRIP_KIND_LABELS.BARE_CHASSIS)
  }
  else if (props.containerType) {
    bits.push(CONTAINER_TYPE_LABELS[props.containerType])
    bits.push(props.isLoaded ? 'Loaded' : 'Empty')
  }
  else if (props.isLoaded != null) {
    bits.push(props.isLoaded ? 'Loaded' : 'Empty')
  }
  bits.push(`${formatTime(props.pickedUpAt ?? props.createdAt)} → ${formatTime(props.droppedOffAt)}`)
  return bits.join(' · ')
})
</script>

<template>
  <NuxtLink
    :to="`/trips/${id}`"
    class="trip-move"
    :class="TRIP_STATUS_CHIP[status]"
  >
    <span
      class="trip-move-rail"
      aria-hidden="true"
    />
    <div class="trip-move-body">
      <div class="trip-move-top">
        <b class="mono">
          <i
            v-if="containerType && !isBareChassis"
            class="type-swatch"
            :class="containerType"
            aria-hidden="true"
          />
          <span>{{ title }}</span>
        </b>
      </div>
      <p class="trip-move-route">
        <span>{{ origin }}</span>
        <span
          class="trip-move-arrow"
          aria-hidden="true"
        />
        <span class="to">{{ destination }}</span>
      </p>
      <p class="trip-move-meta">
        {{ metaLine }}
      </p>
    </div>
  </NuxtLink>
</template>
