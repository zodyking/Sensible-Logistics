<script setup lang="ts">
import type { TaskStep } from '#shared/utils/task-steps'
import { groupTasksByWorkDate } from '#shared/utils/task-days'

useHead({ title: 'Tasks' })

const { data, status, error, refresh } = await useFetch('/api/tasks')

const menuOpen = ref(false)
const adding = ref(false)
const composeOpen = ref(false)
const draft = ref('')
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>()
const flash = ref('')
const actionError = ref('')

const todayIso = computed(() => data.value?.todayIso ?? '')
const allTasks = computed(() => data.value?.tasks ?? [])
const taskDays = computed(() => groupTasksByWorkDate(allTasks.value, todayIso.value))

onMounted(() => {
  const tick = () => {
    if (document.visibilityState !== 'visible') return
    if (composeOpen.value || persistTimers.size || adding.value) return
    void refresh()
  }
  const id = window.setInterval(tick, 12000)
  document.addEventListener('visibilitychange', tick)
  onBeforeUnmount(() => {
    window.clearInterval(id)
    document.removeEventListener('visibilitychange', tick)
    for (const timer of persistTimers.values()) clearTimeout(timer)
    persistTimers.clear()
  })
})

async function submitDraft() {
  const text = draft.value.trim()
  if (!text || adding.value) return
  adding.value = true
  actionError.value = ''
  try {
    await $fetch('/api/tasks', { method: 'POST', body: { text } })
    draft.value = ''
    composeOpen.value = false
    flash.value = 'Your note was added.'
    await refresh()
  }
  catch (err) {
    actionError.value = apiErrorMessage(err, 'Could not add that work.')
  }
  finally {
    adding.value = false
  }
}

function applyStepsLocally(id: string, steps: TaskStep[]) {
  const task = data.value?.tasks.find(row => row.id === id)
  if (!task) return
  task.steps = steps
  const done = steps.length > 0 && steps.every(step => step.done)
  const some = steps.some(step => step.done) && !done
  if (done) task.status = 'DONE'
  else if (some) task.status = 'IN_PROGRESS'
  else if (task.status === 'DONE') task.status = 'OPEN'
}

async function flushSteps(id: string, steps: TaskStep[]) {
  actionError.value = ''
  try {
    const result = await $fetch<{ task: { status: string, title: string, rawText: string } }>(
      `/api/tasks/${id}`,
      { method: 'PATCH', body: { steps } },
    )
    const task = data.value?.tasks.find(row => row.id === id)
    if (task && result.task) {
      task.status = result.task.status as typeof task.status
      task.title = result.task.title
      task.rawText = result.task.rawText
    }
  }
  catch (err) {
    actionError.value = apiErrorMessage(err, 'Could not update the steps.')
  }
}

function persistSteps(id: string, steps: TaskStep[], immediate = true) {
  applyStepsLocally(id, steps)
  const pending = persistTimers.get(id)
  if (pending) clearTimeout(pending)
  if (immediate) {
    persistTimers.delete(id)
    void flushSteps(id, steps)
    return
  }
  persistTimers.set(id, setTimeout(() => {
    persistTimers.delete(id)
    void flushSteps(id, steps)
  }, 320))
}

async function patchTask(id: string, statusValue: 'DONE' | 'DISMISSED') {
  actionError.value = ''
  try {
    await $fetch(`/api/tasks/${id}`, { method: 'PATCH', body: { status: statusValue } })
    await refresh()
  }
  catch (err) {
    actionError.value = apiErrorMessage(err, 'Could not update the task.')
  }
}
</script>

<template>
  <section class="d-page">
    <PageHeader
      eyebrow="Work"
      title="Tasks"
    >
      <template #actions>
        <button
          type="button"
          class="icon-btn"
          aria-label="Task actions"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
          @click="menuOpen = true"
        >
          ⋮
        </button>
      </template>
    </PageHeader>

    <div
      v-if="status === 'pending' && !data"
      class="card p-6 text-center text-sm text-[var(--color-ink-500)]"
      role="status"
    >
      Loading tasks…
    </div>

    <p
      v-else-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ apiErrorMessage(error, 'Could not load tasks.') }}</span>
    </p>

    <template v-else-if="data">
      <p
        v-if="actionError"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ actionError }}</span>
      </p>
      <p
        v-else-if="flash"
        class="banner ok"
        role="status"
      >
        <span aria-hidden="true">✓</span>
        <span>{{ flash }}</span>
      </p>

      <form
        v-if="composeOpen"
        class="task-compose card"
        @submit.prevent="submitDraft"
      >
        <label
          class="sr-only"
          for="task-blob"
        >Add your own note</label>
        <textarea
          id="task-blob"
          v-model="draft"
          class="task-compose-input"
          rows="5"
          placeholder="Your own note for today. Dispatch work stays as assigned."
          autocomplete="off"
        />
        <p class="task-compose-hint">
          Files under today. Dispatch cards cannot be rewritten from here.
        </p>
        <button
          class="btn-dark"
          type="submit"
          :disabled="adding || !draft.trim()"
        >
          {{ adding ? 'Adding…' : 'Add note' }}
        </button>
      </form>

      <template
        v-for="group in taskDays"
        :key="group.iso"
      >
        <div class="section-label">
          <span>{{ formatDayOf(group.iso, todayIso) }}</span>
          <span v-if="group.tasks.length">{{ group.tasks.length }}</span>
        </div>

        <template
          v-for="task in group.tasks"
          :key="task.id"
        >
          <DispatchTaskCard
            :id="task.id"
            :title="task.title"
            :raw-text="task.rawText"
            :sender="task.sender"
            :received-at="task.receivedAt"
            :work-date="task.workDate"
            :kind="task.kind"
            :status="task.status"
            :source="task.source"
            :assigned="task.assigned"
            :editable="task.editable"
            :trip-id="task.tripId"
            :steps="task.steps"
            :card="task.card"
            :compact="group.iso < todayIso"
            actions
            @done="patchTask(task.id, 'DONE')"
            @dismiss="patchTask(task.id, 'DISMISSED')"
          />
          <TaskChecklist
            v-if="task.editable && group.iso >= todayIso"
            :steps="task.steps"
            mode="edit"
            @change="(steps, immediate) => persistSteps(task.id, steps, immediate)"
          />
        </template>

        <EmptyState
          v-if="group.iso === todayIso && !group.tasks.length"
          glyph="☰"
          title="No work yet"
          description="Dispatch work appears here after it is submitted. You can still add your own note."
        />
      </template>
    </template>

    <BottomSheet
      :open="menuOpen"
      title="Tasks"
      @close="menuOpen = false"
    >
      <button
        type="button"
        class="menu-row"
        @click="composeOpen = true; menuOpen = false"
      >
        Add a note
      </button>
    </BottomSheet>
  </section>
</template>
