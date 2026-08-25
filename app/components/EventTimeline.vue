<script setup lang="ts">
import { EVENT_GLYPH, EVENT_TYPE_LABELS } from '#shared/utils/domain'
import type { EventType } from '#shared/utils/domain'

interface TimelineEntry {
  id: string
  eventType: EventType
  occurredAt: string | Date
  createdAt?: string | Date
  notes?: string | null
  source?: string | null
  locationName?: string | null
  tripReference?: string | null
  chassisNumber?: string | null
  actorFirstName?: string | null
  actorLastName?: string | null
}

const props = defineProps<{ entries: TimelineEntry[] }>()

/** Immutable history reads newest-first; the rail marks the first and last. */
function nodeClass(entry: TimelineEntry, index: number) {
  if (entry.eventType === 'RELEASED' || entry.eventType === 'DROPOFF_CONFIRMED') return 'final'
  if (entry.eventType === 'DAMAGE_REPORTED' || entry.eventType === 'PICKUP_CANCELLED') return 'alert'
  if (index === props.entries.length - 1) return 'start'
  return ''
}

function meta(entry: TimelineEntry) {
  const actor = [entry.actorFirstName, entry.actorLastName].filter(Boolean).join(' ')
  return [
    formatDateTime(entry.occurredAt),
    entry.locationName,
    actor || null,
    entry.chassisNumber ? `Chassis ${entry.chassisNumber}` : null,
    entry.tripReference,
  ].filter(Boolean).join(' · ')
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
  <ol class="timeline list-none">
    <li
      v-for="(entry, index) in entries"
      :key="entry.id"
      class="tl-item"
    >
      <span
        class="tl-node"
        :class="nodeClass(entry, index)"
        aria-hidden="true"
      >{{ EVENT_GLYPH[entry.eventType] ?? '•' }}</span>
      <div class="tl-title">
        {{ EVENT_TYPE_LABELS[entry.eventType] ?? entry.eventType }}
      </div>
      <div class="tl-meta">
        {{ meta(entry) }}
      </div>
      <p
        v-if="entry.notes"
        class="mt-1 text-xs text-[var(--color-ink-700)]"
      >
        {{ entry.notes }}
      </p>
      <span
        v-if="isDelayed(entry)"
        class="chip warn mt-2"
      >Recorded late</span>
    </li>
  </ol>
</template>
