<script setup lang="ts">
import { mergeWithPrevious, splitStepAt } from '#shared/utils/task-steps'
import type { TaskStep } from '#shared/utils/task-steps'

const props = defineProps<{
  steps: TaskStep[]
  mode: 'view' | 'edit'
  disabled?: boolean
}>()

const emit = defineEmits<{
  change: [steps: TaskStep[], immediate?: boolean]
}>()

function cloneSteps(list: TaskStep[]): TaskStep[] {
  return list.map(step => ({ ...step }))
}

const local = ref<TaskStep[]>(cloneSteps(props.steps))
const emitting = ref(false)
const focusId = ref<string | null>(null)
const focusCaret = ref(0)
const lastSplitIndex = ref<number | null>(null)
const inputEls = new Map<string, HTMLInputElement>()

watch(() => props.steps, (next) => {
  if (emitting.value) return
  local.value = cloneSteps(next)
}, { deep: true })

function bindInput(id: string, el: unknown) {
  if (el instanceof HTMLInputElement) inputEls.set(id, el)
  else inputEls.delete(id)
}

watch(() => local.value.map(step => step.id).join(','), async () => {
  const id = focusId.value
  if (!id) return
  await nextTick()
  const input = inputEls.get(id)
  if (!input) return
  input.focus()
  const caret = Math.min(focusCaret.value, input.value.length)
  input.setSelectionRange(caret, caret)
  focusId.value = null
})

function persist(next: TaskStep[], immediate = true) {
  local.value = next
  emitting.value = true
  emit('change', next, immediate)
  void nextTick(() => {
    emitting.value = false
  })
}

function toggle(id: string) {
  persist(local.value.map(step => step.id === id ? { ...step, done: !step.done } : step))
}

function setText(id: string, text: string) {
  lastSplitIndex.value = null
  persist(local.value.map(step => step.id === id ? { ...step, text } : step), false)
}

function onEnter(index: number, event: KeyboardEvent) {
  if (props.mode !== 'edit') return
  event.preventDefault()
  const input = event.target as HTMLInputElement
  const next = splitStepAt(local.value, index, input.selectionStart ?? input.value.length)
  lastSplitIndex.value = index + 1
  const created = next[index + 1]
  if (created) {
    focusId.value = created.id
    focusCaret.value = 0
  }
  persist(next)
}

function onBackspace(index: number, event: KeyboardEvent) {
  if (props.mode !== 'edit' || index === 0) return
  const input = event.target as HTMLInputElement
  if ((input.selectionStart ?? 0) !== 0 || (input.selectionEnd ?? 0) !== 0) return
  event.preventDefault()
  mergeAt(index)
}

function mergeAt(index: number) {
  const merged = mergeWithPrevious(local.value, index)
  if (!merged) return
  lastSplitIndex.value = null
  const prev = merged.steps[index - 1]
  if (prev) {
    focusId.value = prev.id
    focusCaret.value = merged.caret
  }
  persist(merged.steps)
}

function undoSplit() {
  if (lastSplitIndex.value == null) return
  mergeAt(lastSplitIndex.value)
}

function addStep() {
  const next = [...local.value, { id: crypto.randomUUID(), text: '', done: false }]
  const created = next[next.length - 1]!
  focusId.value = created.id
  focusCaret.value = 0
  lastSplitIndex.value = null
  persist(next)
}
</script>

<template>
  <div class="task-check">
    <div
      v-for="(step, index) in local"
      :key="step.id"
      class="task-check-row"
      :class="{ done: step.done, edit: mode === 'edit' }"
    >
      <label class="task-check-box">
        <input
          type="checkbox"
          :checked="step.done"
          :disabled="disabled"
          :aria-label="step.text || `Step ${index + 1}`"
          @change="toggle(step.id)"
        >
        <span aria-hidden="true" />
      </label>

      <input
        v-if="mode === 'edit'"
        :ref="el => bindInput(step.id, el)"
        class="task-check-input"
        :value="step.text"
        :aria-label="`Step ${index + 1}`"
        @input="setText(step.id, ($event.target as HTMLInputElement).value)"
        @keydown.enter.exact="onEnter(index, $event)"
        @keydown.backspace="onBackspace(index, $event)"
      >
      <span
        v-else
        class="task-check-text"
      >{{ step.text }}</span>

      <button
        v-if="mode === 'edit' && index > 0"
        type="button"
        class="task-check-merge"
        title="Merge with the step above"
        :aria-label="`Merge step ${index + 1} with the step above`"
        @click="mergeAt(index)"
      >
        Undo
      </button>
    </div>

    <div
      v-if="mode === 'edit'"
      class="task-check-tools"
    >
      <button
        type="button"
        class="btn-ghost"
        @click="addStep"
      >
        Add step
      </button>
      <button
        v-if="lastSplitIndex != null"
        type="button"
        class="btn-ghost"
        @click="undoSplit"
      >
        Undo split
      </button>
    </div>
  </div>
</template>
