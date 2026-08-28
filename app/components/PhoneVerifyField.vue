<script setup lang="ts">
import { isValidPhone } from '#shared/utils/phone'

const props = defineProps<{
  mobileNumber: string
  purpose: 'SIGNUP' | 'CHANGE'
}>()

const ticket = defineModel<string>('ticket', { default: '' })
const ready = defineModel<boolean>('ready', { default: true })

const { data: requiredState, error: requiredError, status: requiredStatus } = await useFetch('/api/auth/phone/required')
const required = computed(() => Boolean(requiredState.value?.required) && !requiredError.value)

const sending = ref(false)
const confirming = ref(false)
const sent = ref(false)
const errorMessage = ref('')
const code = ref('')
let pollTimer: ReturnType<typeof setInterval> | undefined

const numberReady = computed(() => isValidPhone(props.mobileNumber))
const verified = computed(() => Boolean(ticket.value))

watchEffect(() => {
  if (requiredStatus.value === 'pending') {
    ready.value = false
    return
  }
  ready.value = !required.value || Boolean(ticket.value)
})

watch(() => props.mobileNumber, () => {
  ticket.value = ''
  sent.value = false
  code.value = ''
  errorMessage.value = ''
  stopPoll()
})

function stopPoll() {
  if (!pollTimer) return
  clearInterval(pollTimer)
  pollTimer = undefined
}

function startPoll() {
  stopPoll()
  pollTimer = setInterval(() => {
    void pollStatus()
  }, 2500)
}

onBeforeUnmount(stopPoll)

async function sendCode() {
  if (sending.value || !numberReady.value) return
  sending.value = true
  errorMessage.value = ''
  ticket.value = ''
  try {
    await $fetch('/api/auth/phone/challenge', {
      method: 'POST',
      body: { mobileNumber: props.mobileNumber, purpose: props.purpose },
    })
    sent.value = true
    startPoll()
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not send the code.')
  }
  finally {
    sending.value = false
  }
}

async function confirmCode() {
  if (confirming.value || !numberReady.value) return
  confirming.value = true
  errorMessage.value = ''
  try {
    const result = await $fetch('/api/auth/phone/confirm', {
      method: 'POST',
      body: {
        mobileNumber: props.mobileNumber,
        purpose: props.purpose,
        code: code.value,
      },
    })
    ticket.value = result.ticket
    stopPoll()
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'That code did not match.')
  }
  finally {
    confirming.value = false
  }
}

async function pollStatus() {
  if (!numberReady.value || ticket.value) {
    stopPoll()
    return
  }
  try {
    const result = await $fetch('/api/auth/phone/status', {
      query: { mobileNumber: props.mobileNumber, purpose: props.purpose },
    })
    if (result.verified && 'ticket' in result && result.ticket) {
      ticket.value = result.ticket
      stopPoll()
    }
  }
  catch {
    // Keep the typed-code path available if status polling fails.
  }
}

function onCodeInput(event: Event) {
  const input = event.target as HTMLInputElement
  const next = input.value.replace(/\D/g, '').slice(0, 6)
  code.value = next
  if (input.value !== next) input.value = next
}
</script>

<template>
  <div
    v-if="required"
    class="phone-verify"
  >
    <p
      v-if="errorMessage"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ errorMessage }}</span>
    </p>

    <p
      v-if="verified"
      class="banner ok"
      role="status"
    >
      <span aria-hidden="true">✓</span>
      <span>Mobile number verified.</span>
    </p>

    <template v-else>
      <button
        class="btn-ghost w-full"
        type="button"
        :disabled="sending || !numberReady"
        @click="sendCode"
      >
        {{ sending ? 'Sending…' : sent ? 'Resend code' : 'Send code' }}
      </button>

      <label
        v-if="sent"
        class="field mt-3"
      >
        <span>Verification code</span>
        <input
          :value="code"
          class="input mono"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
          placeholder="000000"
          @input="onCodeInput"
        >
        <small class="field-hint">Enter the 6-digit code we texted, or reply with it.</small>
      </label>

      <button
        v-if="sent"
        class="btn-dark mt-2"
        type="button"
        :disabled="confirming || code.length !== 6"
        @click="confirmCode"
      >
        {{ confirming ? 'Checking…' : 'Verify number' }}
      </button>
    </template>
  </div>
</template>
