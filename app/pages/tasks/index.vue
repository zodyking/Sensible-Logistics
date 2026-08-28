<script setup lang="ts">
useHead({ title: 'Tasks' })

type PhoneGuide = 'iphone' | 'android'
type CopyKey = 'url' | 'phrase' | 'json'

const { data, status, error, refresh } = await useFetch('/api/tasks')

const guide = ref<PhoneGuide>('iphone')
const setupOpen = ref(true)
const setupToggleLocked = ref(false)
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

const jsonBody = computed(() => JSON.stringify({
  text: '(the SMS text)',
  from: '(the sender)',
}, null, 2))

watch(() => setup.value?.tested, (tested) => {
  if (setupToggleLocked.value) return
  if (tested) setupOpen.value = false
}, { immediate: true })

onMounted(() => {
  const tick = () => {
    if (document.visibilityState === 'visible') void refresh()
  }
  const id = window.setInterval(tick, 12000)
  document.addEventListener('visibilitychange', tick)
  onBeforeUnmount(() => {
    window.clearInterval(id)
    document.removeEventListener('visibilitychange', tick)
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
    await nextTick()
    document.querySelector('.task-test-result')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
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

const setupStateLabel = computed(() => {
  if (setup.value?.tested) return 'Forwarding confirmed'
  if (setup.value?.connected) return 'Messages arriving'
  return 'Not connected'
})
</script>

<template>
  <section class="d-page">
    <span class="eyebrow">Dispatch</span>
    <h1 class="d-title">
      Tasks
    </h1>

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

      <div
        class="task-setup-status card"
        :class="{ ready: setup?.tested, pending: !setup?.tested }"
      >
        <div class="task-setup-status-row">
          <div>
            <small class="eyebrow">SMS inbox</small>
            <b>{{ setupStateLabel }}</b>
            <p v-if="setup?.lastTestAt">
              Test received {{ formatRelative(setup.lastTestAt) }}
            </p>
            <p v-else-if="setup?.lastReceivedAt">
              Last message {{ formatRelative(setup.lastReceivedAt) }}
            </p>
            <p v-else>
              Forward dispatcher texts from your phone. Only work messages become tasks.
            </p>
          </div>
          <button
            type="button"
            class="btn-ghost"
            :aria-expanded="setupOpen"
            @click="setupToggleLocked = true; setupOpen = !setupOpen"
          >
            {{ setupOpen ? 'Hide setup' : 'Setup' }}
          </button>
        </div>
      </div>

      <div
        v-if="setupOpen && setup"
        class="task-setup card"
      >
        <h2>Connect dispatcher texts</h2>
        <p class="task-setup-lead">
          Your boss texts you the day’s work. iPhone Shortcuts or an Android automation
          forwards those SMS messages here. We keep lines with pickup, drop-off, or
          “work for tomorrow” (including the misspelling <i>tommorow</i>).
        </p>

        <div
          class="view-toggle"
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
          <li>
            Open the <b>Shortcuts</b> app (built in on iPhone).
          </li>
          <li>
            Tap <b>Automation</b>, then <b>+</b>, then <b>Create Personal Automation</b>.
          </li>
          <li>
            Choose <b>Message</b> → <b>Message Received</b>. Optionally set Sender to your dispatcher so only their texts forward.
          </li>
          <li>
            Add action <b>Get Contents of URL</b>. Paste the webhook URL below.
          </li>
          <li>
            Method <b>POST</b>. Headers: <span class="mono">Content-Type: application/json</span>.
            Request body JSON with keys <span class="mono">text</span> (the message) and
            <span class="mono">from</span> (the sender).
          </li>
          <li>
            Tap Next. Turn <b>Ask Before Running</b> off, then Don’t Notify, then Done.
            iOS may ask you to confirm the first few runs.
          </li>
        </ol>

        <ol
          v-else
          class="task-steps"
        >
          <li>
            Install <b>MacroDroid</b> or <b>Tasker</b> and grant SMS permission.
          </li>
          <li>
            <b>MacroDroid:</b> Trigger = SMS Received (optionally from your dispatcher).
            Action = HTTP Request, method POST, URL = the webhook below, content type JSON,
            body <span class="mono">{"text":"[sms_message]","from":"[sms_number]"}</span>.
          </li>
          <li>
            <b>Tasker:</b> Profile → Event → Phone → Received Text. Task → HTTP Request POST
            with body JSON using <span class="mono">%SMSRB</span> (text) and
            <span class="mono">%SMSRF</span> (sender).
          </li>
          <li>
            Save the macro and send a test from another phone.
          </li>
        </ol>

        <div class="task-copy-block">
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

        <div class="task-copy-block">
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

        <div class="task-test">
          <h3>Test that it works</h3>
          <ol class="task-steps">
            <li>
              Copy the test phrase
              <code class="mono">{{ setup.testPhrase }}</code>
              and send it in a text that your automation will forward — from another phone,
              or to yourself if the automation is not sender-filtered.
            </li>
            <li>
              Wait a few seconds, then tap <b>Check now</b>. This screen looks for that phrase
              on the webhook. A green “Forwarding confirmed” means Shortcuts or Android is wired.
            </li>
          </ol>
          <div class="task-copy-block">
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
          <p class="field-hint">
            “Check the link only” POSTs the test phrase from this app. That proves the URL is
            reachable, not that Messages are forwarding. Use Check now after a real SMS for the
            full test.
          </p>
        </div>

        <button
          type="button"
          class="btn-ghost task-rotate"
          @click="confirmRotate = true"
        >
          Rotate webhook link
        </button>
      </div>

      <div class="section-label">
        <span>Today</span>
        <span v-if="todayTasks.length">{{ todayTasks.length }}</span>
      </div>
      <DispatchTaskCard
        v-for="task in todayTasks"
        :id="task.id"
        :key="task.id"
        :title="task.title"
        :raw-text="task.rawText"
        :sender="task.sender"
        :received-at="task.receivedAt"
        :work-date="task.workDate"
        :kind="task.kind"
        :status="task.status"
        :trip-id="task.tripId"
        actions
        @done="patchTask(task.id, 'DONE')"
        @dismiss="patchTask(task.id, 'DISMISSED')"
      />
      <EmptyState
        v-if="!todayTasks.length"
        glyph="☰"
        title="No tasks for today"
        description="When a dispatcher text matches pickup, drop-off, or work for today, it lands here."
      />

      <template v-if="upcomingTasks.length">
        <div class="section-label">
          <span>Upcoming</span>
          <span>{{ upcomingTasks.length }}</span>
        </div>
        <DispatchTaskCard
          v-for="task in upcomingTasks"
          :id="task.id"
          :key="task.id"
          :title="task.title"
          :raw-text="task.rawText"
          :sender="task.sender"
          :received-at="task.receivedAt"
          :work-date="task.workDate"
          :kind="task.kind"
          :status="task.status"
          :trip-id="task.tripId"
          actions
          @done="patchTask(task.id, 'DONE')"
          @dismiss="patchTask(task.id, 'DISMISSED')"
        />
      </template>

      <template v-if="earlierTasks.length">
        <div class="section-label">
          <span>Earlier</span>
        </div>
        <DispatchTaskCard
          v-for="task in earlierTasks"
          :id="task.id"
          :key="task.id"
          :title="task.title"
          :raw-text="task.rawText"
          :sender="task.sender"
          :received-at="task.receivedAt"
          :work-date="task.workDate"
          :kind="task.kind"
          :status="task.status"
          :trip-id="task.tripId"
          compact
          actions
          @done="patchTask(task.id, 'DONE')"
          @dismiss="patchTask(task.id, 'DISMISSED')"
        />
      </template>
    </template>

    <BottomSheet
      :open="confirmRotate"
      title="Rotate webhook?"
      @close="confirmRotate = false"
    >
      <p class="text-sm text-[var(--color-ink-500)]">
        The old URL stops working. Update the URL in Shortcuts or Android after this, then send
        the test phrase again.
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
