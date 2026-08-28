<script setup lang="ts">
import {
  DISPATCH_TASK_KIND_LABELS,
  DISPATCH_TASK_STATUS_CHIP,
} from '#shared/utils/domain'
import type { DispatchTaskKind, DispatchTaskStatus } from '#shared/utils/domain'

const props = defineProps<{
  id: string
  title: string
  rawText: string
  sender?: string | null
  receivedAt: string | Date
  workDate: string
  kind: DispatchTaskKind
  status: DispatchTaskStatus
  tripId?: string | null
  steps?: Array<{ id: string, text: string, done: boolean }>
  compact?: boolean
  actions?: boolean
}>()

const emit = defineEmits<{
  done: []
  dismiss: []
}>()

const doneCount = computed(() => (props.steps ?? []).filter(step => step.done).length)
const stepCount = computed(() => props.steps?.length ?? 0)
const kindLabel = computed(() => DISPATCH_TASK_KIND_LABELS[props.kind])
const canStartPickup = computed(() =>
  props.actions
  && props.status !== 'DONE'
  && props.status !== 'DISMISSED'
  && (props.kind === 'PICKUP' || props.kind === 'WORK'),
)
</script>

<template>
  <article
    class="task-card"
    :class="{ compact, done: status === 'DONE', dismissed: status === 'DISMISSED' }"
  >
    <div class="task-card-top">
      <StatusChip
        :variant="DISPATCH_TASK_STATUS_CHIP[status]"
        :label="kindLabel"
      />
      <span class="task-card-when">{{ formatRelative(receivedAt) }}</span>
    </div>
    <h3 class="task-card-title">
      {{ title }}
    </h3>
    <p
      v-if="!compact"
      class="task-card-body"
    >
      {{ rawText }}
    </p>
    <p class="task-card-meta">
      <span>{{ formatWorkDate(workDate) }}</span>
      <span v-if="sender">From {{ sender }}</span>
      <span v-if="stepCount">{{ doneCount }}/{{ stepCount }} steps</span>
    </p>
    <div
      v-if="actions && status !== 'DISMISSED'"
      class="task-card-actions"
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
        Done
      </button>
      <button
        v-if="status === 'OPEN' || status === 'IN_PROGRESS'"
        type="button"
        class="btn-ghost"
        @click="emit('dismiss')"
      >
        Dismiss
      </button>
    </div>
  </article>
</template>
