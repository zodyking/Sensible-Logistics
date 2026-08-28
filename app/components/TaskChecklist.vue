<script setup lang="ts">
import { splitStepAt, splitStepLines, mergeWithPrevious } from '#shared/utils/task-steps'
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
const carets = new Map<string, number>()
const inputEls = new Map<string, HTMLTextAreaElement>()

watch(() => props.steps, (next) => {
  if (emitting.value) return
  local.value = cloneSteps(next)
}, { deep: true })

function bindInput(id: string, el: unknown) {
  if (el instanceof HTMLTextAreaElement) inputEls.set(id, el)
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
  persist(local.value.map(step => step.id === id ? { ...step, text } : step), false)
}

function rememberCaret(id: string, event: Event) {
  const input = event.target as HTMLTextAreaElement
  carets.set(id, input.selectionStart ?? input.value.length)
}

function caretFor(index: number): number {
  const step = local.value[index]
  if (!step) return 0
  return carets.get(step.id) ?? step.text.length
}

function splitAt(index: number) {
  const next = splitStepAt(local.value, index, caretFor(index))
  const created = next[index + 1]
  if (created) {
    focusId.value = created.id
    focusCaret.value = 0
  }
  persist(next)
}

function splitLines(index: number) {
  const next = splitStepLines(local.value, index)
  const created = next[index]
  if (created) {
    focusId.value = created.id
    focusCaret.value = created.text.length
  }
  persist(next)
}

function mergeAt(index: number) {
  const merged = mergeWithPrevious(local.value, index)
  if (!merged) return
  const prev = merged.steps[index - 1]
  if (prev) {
    focusId.value = prev.id
    focusCaret.value = merged.caret
  }
  persist(merged.steps)
}

function addStep() {
  const next = [...local.value, { id: crypto.randomUUID(), text: '', done: false }]
  const created = next[next.length - 1]!
  focusId.value = created.id
  focusCaret.value = 0
  persist(next)
}

function hasLines(text: string) {
  return text.replace(/\r\n/g, '\n').split('\n').filter(line => line.trim()).length > 1
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

      <div class="task-check-body">
        <textarea
          v-if="mode === 'edit'"
          :ref="el => bindInput(step.id, el)"
          class="task-check-input"
          :rows="Math.max(2, step.text.split('\n').length)"
          :value="step.text"
          :aria-label="`Step ${index + 1}`"
          @input="setText(step.id, ($event.target as HTMLTextAreaElement).value)"
          @click="rememberCaret(step.id, $event)"
          @keyup="rememberCaret(step.id, $event)"
          @select="rememberCaret(step.id, $event)"
        />
        <span
          v-else
          class="task-check-text"
        >{{ step.text }}</span>

        <div
          v-if="mode === 'edit'"
          class="task-check-row-actions"
        >
          <button
            type="button"
            class="task-check-action"
            @click="splitAt(index)"
          >
            Split
          </button>
          <button
            v-if="hasLines(step.text)"
            type="button"
            class="task-check-action"
            @click="splitLines(index)"
          >
            Split lines
          </button>
          <button
            v-if="index > 0"
            type="button"
            class="task-check-action"
            @click="mergeAt(index)"
          >
            Merge
          </button>
        </div>
      </div>
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
    </div>
  </div>
</template>
