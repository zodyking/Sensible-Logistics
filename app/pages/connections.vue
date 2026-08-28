<script setup lang="ts">
import { formatPhoneDisplay } from '#shared/utils/phone'

useHead({ title: 'API connections' })

const { user } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')

const { data: features } = await useFetch('/api/features')
const connectionsUnlocked = Boolean(features.value?.unlocked?.includes('CONNECTIONS'))
if (!connectionsUnlocked) {
  await navigateTo('/more', { replace: true })
}

const SAVED_MASK = '••••••••••••'

interface QuoView {
  enabled: boolean
  hasApiKey: boolean
  fromNumber: string | null
  configured: boolean
  webhookConfigured: boolean
  webhookUrl: string | null
}

interface QuoPhoneOption {
  id: string
  number: string
  formattedNumber?: string | null
  name?: string | null
}

const { data: quo, refresh } = await useFetch<QuoView>('/api/integrations/quo', {
  immediate: connectionsUnlocked,
})

const form = reactive({
  enabled: false,
  apiKey: '',
  fromNumber: '',
})

watch(() => quo.value, (value) => {
  if (!value) return
  form.enabled = value.enabled
  form.fromNumber = value.fromNumber ?? ''
  form.apiKey = value.hasApiKey ? SAVED_MASK : ''
}, { immediate: true })

const phoneOptions = ref<QuoPhoneOption[]>([])
const numbersLoaded = ref(false)

function optionLabel(row: QuoPhoneOption) {
  const raw = row.formattedNumber?.trim() || row.number
  const number = formatPhoneDisplay(raw) || raw
  const name = row.name?.trim()
  return name ? `${number} — ${name}` : number
}

function applyPhoneOptions(rows: QuoPhoneOption[]) {
  phoneOptions.value = rows.filter(row => row.number)
  numbersLoaded.value = true
  const current = form.fromNumber.trim()
  const match = phoneOptions.value.find(row => row.number === current)
  if (match) {
    form.fromNumber = match.number
    return
  }
  if (!current && phoneOptions.value.length === 1) {
    form.fromNumber = phoneOptions.value[0]!.number
  }
}

const fromNumberSelectOptions = computed(() => {
  const options = [...phoneOptions.value]
  const current = form.fromNumber.trim()
  if (current && !options.some(row => row.number === current)) {
    options.unshift({
      id: 'saved',
      number: current,
      formattedNumber: current,
      name: numbersLoaded.value ? 'Saved (not in latest Quo list)' : 'Saved',
    })
  }
  return options
})

const saveBusy = ref(false)
const testBusy = ref(false)
const webhookBusy = ref(false)
const message = ref('')
const errorMessage = ref('')

function apiKeyForSave() {
  const trimmed = form.apiKey.trim()
  if (!trimmed || trimmed === SAVED_MASK) return undefined
  return trimmed
}

async function testConnection() {
  if (testBusy.value) return
  testBusy.value = true
  errorMessage.value = ''
  message.value = ''
  try {
    const apiKey = apiKeyForSave()
    const result = await $fetch('/api/integrations/quo/test', {
      method: 'POST',
      body: apiKey ? { apiKey } : {},
    })
    applyPhoneOptions(result.phoneNumbers)
    message.value = result.message
    if (!result.ok) errorMessage.value = result.message
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not reach Quo.')
  }
  finally {
    testBusy.value = false
  }
}

async function save() {
  if (saveBusy.value) return
  saveBusy.value = true
  errorMessage.value = ''
  message.value = ''
  try {
    const body: Record<string, unknown> = {
      enabled: form.enabled,
      fromNumber: form.fromNumber.trim() || undefined,
    }
    const nextKey = apiKeyForSave()
    if (nextKey !== undefined) body.apiKey = nextKey
    const result = await $fetch<QuoView>('/api/integrations/quo', { method: 'PATCH', body })
    form.enabled = result.enabled
    form.fromNumber = result.fromNumber ?? ''
    form.apiKey = result.hasApiKey ? SAVED_MASK : ''
    message.value = result.enabled
      ? (result.webhookConfigured
          ? 'Quo saved and enabled.'
          : 'Quo saved and enabled. Repair the webhook if inbound texts are needed.')
      : 'Quo settings saved.'
    await refresh()
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not save Quo settings.')
  }
  finally {
    saveBusy.value = false
  }
}

async function repairWebhook() {
  if (webhookBusy.value) return
  webhookBusy.value = true
  errorMessage.value = ''
  message.value = ''
  try {
    const result = await $fetch<QuoView>('/api/integrations/quo/webhook', { method: 'POST' })
    message.value = result.webhookConfigured
      ? 'Inbound webhook registered.'
      : 'Webhook repair finished.'
    await refresh()
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not repair the webhook.')
  }
  finally {
    webhookBusy.value = false
  }
}
</script>

<template>
  <section
    v-if="connectionsUnlocked"
    class="d-page"
  >
    <PageHeader
      eyebrow="System"
      title="API connections"
      back-to="/more"
      back-label="More"
    />

    <p
      v-if="errorMessage"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ errorMessage }}</span>
    </p>
    <p
      v-if="message"
      class="banner ok"
      role="status"
    >
      <span aria-hidden="true">✓</span>
      <span>{{ message }}</span>
    </p>

    <p class="section-label !mt-2">
      Quo
    </p>
    <form
      class="card p-4"
      novalidate
      @submit.prevent="save"
    >
      <label class="switch-row">
        <span>Enable</span>
        <button
          type="button"
          class="switch"
          role="switch"
          :aria-checked="form.enabled"
          :class="{ on: form.enabled }"
          @click="form.enabled = !form.enabled"
        >
          <span class="sr-only">{{ form.enabled ? 'Enabled' : 'Disabled' }}</span>
        </button>
      </label>

      <label class="field">
        <span>API key</span>
        <input
          v-model="form.apiKey"
          class="input"
          type="password"
          autocomplete="off"
          spellcheck="false"
        >
      </label>

      <button
        class="btn-ghost w-full"
        type="button"
        :disabled="testBusy"
        @click="testConnection"
      >
        {{ testBusy ? 'Testing…' : 'Test connection' }}
      </button>

      <label class="field mt-3">
        <span>Platform number</span>
        <select
          v-model="form.fromNumber"
          class="select"
        >
          <option value="">
            Select a number
          </option>
          <option
            v-for="row in fromNumberSelectOptions"
            :key="row.id || row.number"
            :value="row.number"
          >
            {{ optionLabel(row) }}
          </option>
        </select>
        <small class="field-hint">Only this number is used. Other Quo numbers are ignored.</small>
      </label>

      <button
        class="btn-dark mt-2"
        type="submit"
        :disabled="saveBusy"
      >
        {{ saveBusy ? 'Saving…' : 'Save' }}
      </button>
    </form>

    <p class="section-label">
      Webhook
    </p>
    <div class="card p-4">
      <div class="conn-meta">
        <span>Status</span>
        <StatusChip
          :variant="quo?.webhookConfigured ? 'ok' : 'idle'"
          :label="quo?.webhookConfigured ? 'Registered' : 'Not registered'"
        />
      </div>
      <div class="conn-meta">
        <span>URL</span>
        <code class="conn-url">{{ quo?.webhookUrl || 'Save an enabled key to register' }}</code>
      </div>
      <button
        class="btn-ghost mt-4 w-full"
        type="button"
        :disabled="webhookBusy || !quo?.hasApiKey"
        @click="repairWebhook"
      >
        {{ webhookBusy ? 'Repairing…' : 'Repair webhook' }}
      </button>
    </div>
  </section>
</template>
