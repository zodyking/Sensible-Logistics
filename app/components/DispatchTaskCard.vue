<script setup lang="ts">
import {
  DISPATCH_TASK_KIND_LABELS,
  DISPATCH_TASK_SOURCE_LABELS,
  DISPATCH_TASK_STATUS_CHIP,
  DISPATCH_TASK_STATUS_LABELS,
  type DispatchTaskKind,
  type DispatchTaskSource,
  type DispatchTaskStatus,
} from '#shared/utils/domain'
import { displayContainerNumber, type DispatchCard } from '#shared/utils/dispatch-cards'

const props = defineProps<{
  id: string
  title: string
  rawText: string
  sender?: string | null
  receivedAt: string | Date
  workDate: string
  kind: DispatchTaskKind
  status: DispatchTaskStatus
  source?: DispatchTaskSource
  assigned?: boolean
  editable?: boolean
  tripId?: string | null
  steps?: Array<{ id: string, text: string, done: boolean }>
  card?: DispatchCard | null
  compact?: boolean
  actions?: boolean
}>()

const emit = defineEmits<{
  done: []
  dismiss: []
}>()

const assigned = computed(() => props.assigned ?? (props.source === 'DISPATCH' || props.source === 'SMS'))
const sourceLabel = computed(() => DISPATCH_TASK_SOURCE_LABELS[props.source ?? (assigned.value ? 'DISPATCH' : 'MANUAL')])
const box = computed(() => displayContainerNumber(props.card?.containerNumber ?? ''))
const from = computed(() => props.card?.locationName?.trim() || '')
const to = computed(() => props.card?.destinationLocationName?.trim() || '')
const notes = computed(() => (assigned.value ? (props.card?.notes?.trim() || '') : ''))
const kindLabel = computed(() => DISPATCH_TASK_KIND_LABELS[props.kind])
const doneCount = computed(() => (props.steps ?? []).filter(step => step.done).length)
const stepCount = computed(() => props.steps?.length ?? 0)
const canStartPickup = computed(() =>
  props.actions
  && props.status !== 'DONE'
  && props.status !== 'DISMISSED'
  && (props.kind === 'PICKUP' || props.kind === 'WORK' || props.kind === 'LOAD' || props.kind === 'EMPTY'),
)
</script>

<template>
  <article
    class="task-view"
    :class="{ compact, done: status === 'DONE', dismissed: status === 'DISMISSED', assigned }"
  >
    <div class="task-view-top">
      <StatusChip
        :variant="DISPATCH_TASK_STATUS_CHIP[status]"
        :label="status === 'DONE' ? DISPATCH_TASK_STATUS_LABELS.DONE : kindLabel"
      />
      <span class="task-view-source">{{ sourceLabel }}</span>
    </div>

    <h3
      v-if="box"
      class="task-view-box mono"
    >
      {{ box }}
    </h3>
    <h3
      v-else
      class="task-view-title"
    >
      {{ title }}
    </h3>

    <p
      v-if="from || to"
      class="task-view-route"
    >
      <span>{{ from || '—' }}</span>
      <span
        v-if="to"
        class="task-view-arrow"
        aria-hidden="true"
      />
      <span v-if="to">{{ to }}</span>
    </p>

    <p
      v-if="card?.containerPending"
      class="task-view-pending"
    >
      Not in the yard yet
    </p>

    <p
      v-if="!compact && notes"
      class="task-view-notes"
    >
      {{ notes }}
    </p>

    <p class="task-view-meta">
      <span>{{ formatWorkDate(workDate) }}</span>
      <span v-if="sender && assigned">From {{ sender }}</span>
      <span v-if="stepCount && !assigned">{{ doneCount }}/{{ stepCount }}</span>
    </p>

    <div
      v-if="actions && status !== 'DISMISSED'"
      class="task-view-actions"
    >
      <NuxtLink
        v-if="canStartPickup"
        to="/pickups/new"
        class="btn-dark"
      >
        Start pickup
      </NuxtLink>
      <NuxtLink
        v-if="tripId"
        :to="`/trips/${tripId}`"
        class="btn-ghost"
      >
        Trip
      </NuxtLink>
      <button
        v-if="status !== 'DONE'"
        type="button"
        class="btn-ghost"
        @click="emit('done')"
      >
        Mark done
      </button>
      <button
        v-if="editable && (status === 'OPEN' || status === 'IN_PROGRESS')"
        type="button"
        class="btn-ghost"
        @click="emit('dismiss')"
      >
        Remove
      </button>
    </div>
  </article>
</template>
