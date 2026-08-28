<script setup lang="ts">
import { stepsFromBlob } from '#shared/utils/task-steps'
import type { TaskStep } from '#shared/utils/task-steps'

useHead({ title: 'Tasks' })

type PhoneGuide = 'iphone' | 'android'
type CopyKey = 'url' | 'phrase' | 'json'
type PageMode = 'view' | 'edit'

const { data, status, error, refresh } = await useFetch('/api/tasks')

const mode = ref<PageMode>('edit')
const draft = ref('')
const adding = ref(false)
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>()
const guide = ref<PhoneGuide>('iphone')
const setupOpen = ref(false)
const checking = ref(false)
const pinging = ref(false)
const rotating = ref(false)
const confirmRotate = ref(false)
const flash = ref('')
const testResult = ref('')
const actionError = ref('')
const copyState = reactive<Record<CopyKey, 'idle' | 'copied' | 'failed'>>({
  url: 'idle',
  phrase: 'idle',
  json: 'idle',
})
const copyTimers: Partial<Record<CopyKey, ReturnType<typeof setTimeout>>> = {}

const setup = computed(() => data.value?.setup)
const todayIso = computed(() => data.value?.todayIso ?? '')
const allTasks = computed(() => data.value?.tasks ?? [])

const todayTasks = computed(() =>
  allTasks.value.filter(task => task.workDate === todayIso.value && task.status !== 'DISMISSED'),
)
const upcomingTasks = computed(() =>
  allTasks.value.filter(task => task.workDate > todayIso.value && task.status !== 'DISMISSED'),
)
const earlierTasks = computed(() =>
  allTasks.value.filter(task => task.workDate < todayIso.value && task.status !== 'DISMISSED'),
)

const draftSteps = computed(() => stepsFromBlob(draft.value))

const jsonBody = computed(() => JSON.stringify({
  text: '(the SMS text)',
  from: '(the sender)',
}, null, 2))

const setupStateLabel = computed(() => {
  if (setup.value?.tested) return 'SMS on'
  if (setup.value?.connected) return 'SMS receiving'
  return 'SMS forwarding'
})

onMounted(() => {
  if (todayTasks.value.length) mode.value = 'view'
  const tick = () => {
    if (document.visibilityState !== 'visible') return
    if (mode.value === 'edit' || persistTimers.size || adding.value) return
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

async function copyValue(key: CopyKey, value: string) {
  try {
    await navigator.clipboard.writeText(value)
    copyState[key] = 'copied'
  }
  catch {
    copyState[key] = 'failed'
  }
  if (copyTimers[key]) clearTimeout(copyTimers[key])
  copyTimers[key] = setTimeout(() => {
    copyState[key] = 'idle'
  }, 2200)
}

async function submitDraft() {
  const text = draft.value.trim()
  if (!text || adding.value) return
  adding.value = true
  actionError.value = ''
  try {
    await $fetch('/api/tasks', { method: 'POST', body: { text } })
    draft.value = ''
    mode.value = 'edit'
    await refresh()
  }
  catch (err) {
    actionError.value = apiErrorMessage(err, 'Could not add that work.')
  }
  finally {
    adding.value = false
  }
}

function onDraftEnter(event: KeyboardEvent) {
  if (event.shiftKey) return
  if (event.metaKey || event.ctrlKey) {
    event.preventDefault()
    void submitDraft()
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

async function checkNow() {
  checking.value = true
  actionError.value = ''
  try {
    await refresh()
    if (setup.value?.tested) {
      flash.value = 'Setup test received. SMS forwarding is working.'
      testResult.value = 'Forwarding confirmed — the test phrase arrived on this webhook.'
    }
    else if (setup.value?.connected) {
      flash.value = 'A message arrived, but not the setup test phrase yet.'
      testResult.value = 'A message arrived, but it was not the setup test phrase.'
    }
    else {
      flash.value = 'Nothing received yet. Send the test phrase from Messages, then check again.'
      testResult.value = 'Nothing received yet. Send the test phrase from Messages, then check again.'
    }
  }
  catch (err) {
    actionError.value = apiErrorMessage(err, 'Could not check setup.')
  }
  finally {
    checking.value = false
  }
}

async function pingWebhook() {
  const url = setup.value?.webhookUrl
  if (!url || pinging.value) return
  pinging.value = true
  actionError.value = ''
  try {
    await $fetch(url, {
      method: 'POST',
      body: { text: setup.value?.testPhrase ?? 'Sensible setup test', from: 'app-check' },
    })
    await refresh()
    flash.value = 'The webhook link is live. That does not prove Shortcuts yet — send the test phrase from Messages for the real check.'
    testResult.value = 'Link is reachable. Send the test phrase from Messages to prove forwarding.'
  }
  catch (err) {
    actionError.value = apiErrorMessage(err, 'Could not reach the webhook.')
  }
  finally {
    pinging.value = false
  }
}

async function rotateToken() {
  if (rotating.value) return
  rotating.value = true
  actionError.value = ''
  try {
    await $fetch('/api/tasks/setup', { method: 'POST' })
    confirmRotate.value = false
    setupOpen.value = true
    await refresh()
    flash.value = 'New webhook link created. Update Shortcuts or Android with the URL below.'
  }
  catch (err) {
    actionError.value = apiErrorMessage(err, 'Could not rotate the webhook.')
  }
  finally {
    rotating.value = false
  }
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
    <div class="task-head">
      <div>
        <span class="eyebrow">Dispatch</span>
        <h1 class="d-title task-title">
          Tasks
        </h1>
      </div>
      <div
        class="view-toggle"
        role="tablist"
        aria-label="Task mode"
      >
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'view'"
          :class="{ on: mode === 'view' }"
          @click="mode = 'view'"
        >
          View
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'edit'"
          :class="{ on: mode === 'edit' }"
          @click="mode = 'edit'"
        >
          Edit
        </button>
      </div>
    </div>

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

      <p
        v-if="mode === 'view' && todayTasks.length"
        class="task-mode-hint"
      >
        Check off work as you go. Switch to Edit to paste, split, or undo a step.
      </p>

      <form
        v-if="mode === 'edit'"
        class="task-compose card"
        @submit.prevent="submitDraft"
      >
        <label
          class="sr-only"
          for="task-blob"
        >Paste today’s work</label>
        <textarea
          id="task-blob"
          v-model="draft"
          class="task-compose-input"
          rows="4"
          placeholder="Paste the container work here. Enter starts a new step."
          autocomplete="off"
          @keydown.enter="onDraftEnter"
        />
        <div
          v-if="draftSteps.length"
          class="task-compose-preview"
          aria-label="Step preview"
        >
          <div
            v-for="step in draftSteps"
            :key="step.id"
            class="task-check-row"
          >
            <span
              class="task-check-box"
              aria-hidden="true"
            >
              <span />
            </span>
            <span class="task-check-text">{{ step.text }}</span>
          </div>
        </div>
        <div class="task-compose-bar">
          <p class="field-hint mb-0">
            Enter new step · Ctrl+Enter saves
          </p>
          <button
            class="btn-dark"
            type="submit"
            :disabled="adding || !draft.trim()"
          >
            {{ adding ? 'Adding…' : 'Add steps' }}
          </button>
        </div>
      </form>

      <div class="section-label">
        <span>Today</span>
        <span v-if="todayTasks.length">{{ todayTasks.length }}</span>
      </div>
      <article
        v-for="task in todayTasks"
        :key="task.id"
        class="task-card task-card-list"
        :class="{ done: task.status === 'DONE' }"
      >
        <div class="task-card-top">
          <StatusChip
            :variant="task.status === 'DONE' ? 'ok' : 'warn'"
            :label="task.status === 'DONE' ? 'Done' : 'Open'"
          />
          <span class="task-card-when">{{ formatWorkDate(task.workDate) }}</span>
        </div>
        <TaskChecklist
          :steps="task.steps"
          :mode="mode"
          @change="(steps, immediate) => persistSteps(task.id, steps, immediate)"
        />
        <div
          v-if="mode === 'edit'"
          class="task-card-actions"
        >
          <button
            type="button"
            class="btn-ghost"
            @click="patchTask(task.id, 'DISMISSED')"
          >
            Remove
          </button>
        </div>
      </article>
      <EmptyState
        v-if="!todayTasks.length"
        glyph="☰"
        title="No steps yet"
        :description="mode === 'edit'
          ? 'Paste the dispatcher text above. Enter starts a new step, then tap Add steps.'
          : 'Switch to Edit to paste today’s container work.'"
      />

      <template v-if="upcomingTasks.length">
        <div class="section-label">
          <span>Upcoming</span>
          <span>{{ upcomingTasks.length }}</span>
        </div>
        <article
          v-for="task in upcomingTasks"
          :key="task.id"
          class="task-card task-card-list"
        >
          <div class="task-card-top">
            <StatusChip
              variant="idle"
              :label="formatWorkDate(task.workDate)"
            />
          </div>
          <TaskChecklist
            :steps="task.steps"
            :mode="mode"
            @change="(steps, immediate) => persistSteps(task.id, steps, immediate)"
          />
        </article>
      </template>

      <template v-if="earlierTasks.length">
        <div class="section-label">
          <span>Earlier</span>
        </div>
        <article
          v-for="task in earlierTasks"
          :key="task.id"
          class="task-card task-card-list compact"
        >
          <div class="task-card-top">
            <StatusChip
              :variant="task.status === 'DONE' ? 'ok' : 'idle'"
              :label="formatWorkDate(task.workDate)"
            />
          </div>
          <TaskChecklist
            :steps="task.steps"
            :mode="mode"
            @change="(steps, immediate) => persistSteps(task.id, steps, immediate)"
          />
        </article>
      </template>

      <button
        type="button"
        class="task-sms-link"
        @click="setupOpen = true"
      >
        <span>{{ setupStateLabel }}</span>
        <span>{{ setup?.tested ? 'Connected' : 'Optional setup' }}</span>
      </button>
    </template>

    <BottomSheet
      :open="setupOpen"
      title="SMS forwarding"
      @close="setupOpen = false"
    >
      <p
        v-if="setup"
        class="text-sm text-[var(--color-ink-700)]"
      >
        Optional. Forward dispatcher texts from iPhone Shortcuts or Android. You can still paste
        work by hand on this page.
      </p>

      <div
        v-if="setup"
        class="view-toggle mt-4"
        role="tablist"
        aria-label="Phone setup"
      >
        <button
          type="button"
          role="tab"
          :aria-selected="guide === 'iphone'"
          :class="{ on: guide === 'iphone' }"
          @click="guide = 'iphone'"
        >
          iPhone
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="guide === 'android'"
          :class="{ on: guide === 'android' }"
          @click="guide = 'android'"
        >
          Android
        </button>
      </div>

      <ol
        v-if="guide === 'iphone'"
        class="task-steps"
      >
        <li>Open Shortcuts → Automation → Create Personal Automation → Message Received.</li>
        <li>Add Get Contents of URL. Paste the webhook. Method POST, JSON body keys text and from.</li>
        <li>Turn Ask Before Running off, then Done.</li>
      </ol>
      <ol
        v-else
        class="task-steps"
      >
        <li>MacroDroid or Tasker: SMS Received → HTTP POST to the webhook as JSON { text, from }.</li>
        <li>Grant SMS permission and send a test from another phone.</li>
      </ol>

      <div
        v-if="setup"
        class="task-copy-block"
      >
        <span class="eyebrow">Webhook URL</span>
        <code class="task-copy-value">{{ setup.webhookUrl }}</code>
        <button
          type="button"
          class="btn-ghost"
          @click="copyValue('url', setup.webhookUrl)"
        >
          {{ copyState.url === 'copied' ? '✓ Copied' : 'Copy URL' }}
        </button>
      </div>
      <div
        v-if="setup"
        class="task-copy-block"
      >
        <span class="eyebrow">JSON body</span>
        <pre class="task-copy-value">{{ jsonBody }}</pre>
        <button
          type="button"
          class="btn-ghost"
          @click="copyValue('json', jsonBody)"
        >
          {{ copyState.json === 'copied' ? '✓ Copied' : 'Copy JSON' }}
        </button>
      </div>
      <div
        v-if="setup"
        class="task-copy-block"
      >
        <span class="eyebrow">Test phrase</span>
        <code class="task-copy-value">{{ setup.testPhrase }}</code>
        <button
          type="button"
          class="btn-ghost"
          @click="copyValue('phrase', setup.testPhrase)"
        >
          {{ copyState.phrase === 'copied' ? '✓ Copied' : 'Copy phrase' }}
        </button>
      </div>
      <div class="task-test-actions">
        <button
          type="button"
          class="btn-dark"
          :disabled="checking"
          @click="checkNow"
        >
          {{ checking ? 'Checking…' : 'Check now' }}
        </button>
        <button
          type="button"
          class="btn-ghost"
          :disabled="pinging"
          @click="pingWebhook"
        >
          {{ pinging ? 'Pinging…' : 'Check the link only' }}
        </button>
      </div>
      <p
        v-if="testResult"
        class="task-test-result"
        :class="{ ok: setup?.tested }"
        role="status"
      >
        {{ testResult }}
      </p>
      <button
        type="button"
        class="btn-ghost task-rotate"
        @click="confirmRotate = true"
      >
        Rotate webhook link
      </button>
    </BottomSheet>

    <BottomSheet
      :open="confirmRotate"
      title="Rotate webhook?"
      @close="confirmRotate = false"
    >
      <p class="text-sm text-[var(--color-ink-500)]">
        The old URL stops working. Update Shortcuts or Android after this, then send the test phrase again.
      </p>
      <div class="sheet-actions">
        <button
          type="button"
          class="btn-cancel"
          @click="confirmRotate = false"
        >
          Cancel
        </button>
        <button
          type="button"
          class="btn-save"
          :disabled="rotating"
          @click="rotateToken"
        >
          {{ rotating ? 'Rotating…' : 'Rotate link' }}
        </button>
      </div>
    </BottomSheet>
  </section>
</template>
