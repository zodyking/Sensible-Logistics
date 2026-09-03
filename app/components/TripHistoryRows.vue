<script setup lang="ts">
import type { ContainerType, TripKind, TripStatus } from '#shared/utils/domain'
import type { GapResolution, TripGap, TripLink } from '#shared/utils/trip-gaps'
import { weaveGapsIntoTrips } from '#shared/utils/trip-gaps'

type HistoryTrip = TripLink & {
  status: TripStatus
  kind?: TripKind | null
  containerNumber?: string | null
  containerType?: ContainerType | null
  chassisNumber?: string | null
  reference: string
  pickedUpAt?: string | null
  droppedOffAt?: string | null
  isLoaded?: boolean | null
  createdAt: string
}

const props = defineProps<{
  trips: HistoryTrip[]
  gaps: TripGap[]
  resolutions: Map<string, GapResolution>
}>()

const emit = defineEmits<{
  resolve: [gap: TripGap, resolution: GapResolution]
}>()

const rows = computed(() => weaveGapsIntoTrips(props.trips, props.gaps))
</script>

<template>
  <template
    v-for="row in rows"
    :key="row.kind === 'trip' ? row.trip.id : row.gap.key"
  >
    <TripGapCard
      v-if="row.kind === 'gap'"
      :gap="row.gap"
      :resolution="resolutions.get(row.gap.key)"
      @resolve="emit('resolve', row.gap, $event)"
    />
    <TripListCard
      v-else
      :id="row.trip.id"
      :status="row.trip.status"
      :kind="row.trip.kind"
      :container-number="row.trip.containerNumber"
      :container-type="row.trip.containerType"
      :chassis-number="row.trip.chassisNumber"
      :reference="row.trip.reference"
      :origin-name="row.trip.originName"
      :destination-name="row.trip.destinationName"
      :picked-up-at="row.trip.pickedUpAt"
      :dropped-off-at="row.trip.droppedOffAt"
      :is-loaded="row.trip.isLoaded"
      :created-at="row.trip.createdAt"
    />
  </template>
</template>
