<script setup lang="ts">
import { concatenateDayWork, type DayWorkTask } from '#shared/utils/task-days'

const props = defineProps<{
  tasks: DayWorkTask[]
  workDate: string
}>()

const expanded = ref(false)

const steps = computed(() => concatenateDayWork(props.tasks))
const doneCount = computed(() => steps.value.filter(step => step.done).length)
const stepCount = computed(() => steps.value.length)
const allDone = computed(() => stepCount.value > 0 && doneCount.value === stepCount.value)

const title = computed(() => {
  if (props.tasks.length === 1) return props.tasks[0]!.title
  return `Work for ${formatWorkDate(props.workDate)}`
})

const receivedAt = computed(() => {
  const stamps = props.tasks
    .map(task => new Date(task.receivedAt).getTime())
    .filter(value => Number.isFinite(value))
  return stamps.length ? new Date(Math.max(...stamps)) : props.workDate
})

function toggle() {
  expanded.value = !expanded.value
}
</script>

<template>
  <article
    v-if="tasks.length"
    class="task-card day-work-card"
    :class="{ done: allDone, open: expanded }"
  >
    <button
      type="button"
      class="day-work-toggle"
      :aria-expanded="expanded"
      @click="toggle"
    >
      <div class="task-card-top">
        <StatusChip
          :variant="allDone ? 'ok' : 'idle'"
          label="Work"
        />
        <span class="task-card-when">{{ formatRelative(receivedAt) }}</span>
      </div>
      <h3 class="task-card-title">
        {{ title }}
      </h3>
      <p class="task-card-meta">
        <span>{{ formatWorkDate(workDate) }}</span>
        <span v-if="stepCount">{{ doneCount }}/{{ stepCount }} steps</span>
        <span
          class="day-work-chev"
          aria-hidden="true"
        >{{ expanded ? '▾' : '›' }}</span>
      </p>
    </button>

    <ol
      v-if="expanded && stepCount"
      class="day-work-pull"
    >
      <li
        v-for="step in steps"
        :key="step.id"
        :class="{ done: step.done }"
      >
        <span
          class="day-work-mark"
          aria-hidden="true"
        >{{ step.done ? '✓' : '○' }}</span>
        <span>{{ step.text }}</span>
      </li>
    </ol>
  </article>
</template>
