<script setup lang="ts">
import type { EventType, LocationType } from '#shared/utils/domain'
import { formatChassisNumber, formatContainerNumber } from '#shared/utils/iso6346'
import {
  driverTimelineTitle,
  timelineNodeKind,
  timelineNote,
  visibleTimelineEntries,
} from '#shared/utils/timeline'

interface TimelineEntry {
  id: string
  eventType: EventType
  occurredAt: string | Date
  createdAt?: string | Date
  notes?: string | null
  source?: string | null
  locationName?: string | null
  locationType?: LocationType | null
  tripReference?: string | null
  chassisNumber?: string | null
  containerNumber?: string | null
  actorFirstName?: string | null
  actorLastName?: string | null
  payload?: Record<string, unknown> | null
}

const props = withDefaults(defineProps<{
  entries: TimelineEntry[]
  /** Hide the marking that already titles this record. */
  subject?: 'trip' | 'container' | 'chassis'
}>(), {
  subject: 'trip',
})

const rows = computed(() => visibleTimelineEntries(props.entries))

function actorName(entry: TimelineEntry) {
  return [entry.actorFirstName, entry.actorLastName].filter(Boolean).join(' ')
}

function chassisLabel(entry: TimelineEntry) {
  if (!entry.chassisNumber) return ''
  return formatChassisNumber(entry.chassisNumber) || entry.chassisNumber
}

function containerLabel(entry: TimelineEntry) {
  if (!entry.containerNumber) return ''
  return formatContainerNumber(entry.containerNumber) || entry.containerNumber
}

/** Delayed entry stays visible rather than being hidden behind occurredAt. */
function isDelayed(entry: TimelineEntry) {
  if (!entry.createdAt) return false
  const occurred = new Date(entry.occurredAt).getTime()
  const created = new Date(entry.createdAt).getTime()
  return created - occurred > 15 * 60 * 1000
}
</script>

<template>
  <p
    v-if="!rows.length"
    class="tl-empty"
  >
    No pickups, drop-offs, or chassis changes yet.
  </p>
  <ol
    v-else
    class="timeline list-none"
  >
    <li
      v-for="entry in rows"
      :key="entry.id"
      class="tl-item"
    >
      <span
        class="tl-node"
        :class="timelineNodeKind(entry.eventType)"
        aria-hidden="true"
      />
      <div class="tl-body">
        <div class="tl-title">
          {{ driverTimelineTitle(entry.eventType) }}
        </div>
        <div class="tl-when">
          {{ formatDateTime(entry.occurredAt) }}
        </div>
        <div
          v-if="entry.locationName"
          class="tl-line"
        >
          {{ entry.locationName }}
        </div>
        <div
          v-if="subject !== 'chassis' && chassisLabel(entry)"
          class="tl-line mono"
        >
          Chassis {{ chassisLabel(entry) }}
        </div>
        <div
          v-if="subject === 'chassis' && containerLabel(entry)"
          class="tl-line mono"
        >
          Container {{ containerLabel(entry) }}
        </div>
        <div
          v-if="subject !== 'trip' && entry.tripReference"
          class="tl-line"
        >
          {{ entry.tripReference }}
        </div>
        <div
          v-if="actorName(entry)"
          class="tl-line tl-who"
        >
          {{ actorName(entry) }}
        </div>
        <p
          v-if="timelineNote(entry.notes)"
          class="tl-note"
        >
          {{ timelineNote(entry.notes) }}
        </p>
        <span
          v-if="isDelayed(entry)"
          class="chip warn mt-2"
        >Recorded late</span>
      </div>
    </li>
  </ol>
</template>
