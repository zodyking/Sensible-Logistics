<script setup lang="ts">
import { formatPhoneInput } from '#shared/utils/phone'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Create a driver account' })

const form = reactive({
  firstName: '',
  lastName: '',
  email: '',
  mobileNumber: '',
  password: '',
  inviteCode: '',
})

/** Masks to (000) 000-0000 as the driver types on the phone keypad. */
function onMobileInput(event: Event) {
  const input = event.target as HTMLInputElement
  const formatted = formatPhoneInput(input.value)
  form.mobileNumber = formatted
  // Keep the DOM in step when the mask rejects a character, otherwise Vue skips
  // the patch (model unchanged) and the stray keystroke stays on screen.
  if (input.value !== formatted) input.value = formatted
}

const submitting = ref(false)
const errorMessage = ref('')
const fieldErrors = ref<Record<string, string>>({})
const phoneTicket = ref('')
const phoneReady = ref(true)

/** Set once the account exists; the form is replaced by the confirmation. */
const submittedEmail = ref('')
const emailSent = ref(true)
/** Only populated in development when SMTP is not configured. */
const devLink = ref<string | null>(null)

const resending = ref(false)
const resendMessage = ref('')

async function submit() {
  if (submitting.value) return
  submitting.value = true
  errorMessage.value = ''
  fieldErrors.value = {}

  try {
    if (!phoneReady.value) {
      errorMessage.value = 'Verify this mobile number before creating your account.'
      return
    }
    const result = await $fetch('/api/auth/signup', {
      method: 'POST',
      body: { ...form, phoneTicket: phoneTicket.value || undefined },
    })
    submittedEmail.value = result.email
    emailSent.value = result.emailSent
    devLink.value = result.devLink ?? null
  }
  catch (error) {
    const issues = (error as { data?: { data?: { issues?: Array<{ path: string, message: string }> } } })
      .data?.data?.issues

    if (issues?.length) {
      fieldErrors.value = Object.fromEntries(issues.map(i => [i.path, i.message]))
      errorMessage.value = 'Check the highlighted fields.'
    }
    else {
      errorMessage.value = apiErrorMessage(error, 'Could not create your account.')
    }
  }
  finally {
    submitting.value = false
  }
}

async function resend() {
  if (resending.value) return
  resending.value = true
  resendMessage.value = ''

  try {
    const result = await $fetch('/api/auth/resend-verification', {
      method: 'POST',
      body: { email: submittedEmail.value },
    })
    resendMessage.value = result.message
    if (result.devLink) devLink.value = result.devLink
  }
  catch (error) {
    resendMessage.value = apiErrorMessage(error, 'Could not resend the link.')
  }
  finally {
    resending.value = false
  }
}
</script>

<template>
  <div v-if="submittedEmail">
    <AuthHeader
      title="Confirm your email"
      subtitle="Almost there"
    />

    <div class="card p-4">
      <p
        v-if="!emailSent"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>
          Your account was created, but the confirmation email could not be sent. Try again below,
          or ask your administrator to check the mail settings.
        </span>
      </p>

      <p class="text-[15px] leading-relaxed">
        We sent a confirmation link to
        <b class="break-all">{{ submittedEmail }}</b>.
        Open it on this phone to activate your account and sign in.
      </p>

      <p class="field-hint mt-3">
        The link expires in 24 hours. If it is not in your inbox, check your spam folder.
      </p>

      <!-- Development convenience: shown only when SMTP is unconfigured. -->
      <div
        v-if="devLink"
        class="banner info mt-4"
      >
        <span aria-hidden="true">▸</span>
        <span class="break-all">
          SMTP is not configured, so no email was sent.
          <NuxtLink
            :to="devLink"
            class="font-semibold underline"
          >
            Open the verification link
          </NuxtLink>
        </span>
      </div>

      <button
        class="btn-ghost mt-4 w-full"
        type="button"
        :disabled="resending"
        @click="resend"
      >
        {{ resending ? 'Sending…' : 'Resend confirmation email' }}
      </button>

      <p
        v-if="resendMessage"
        class="field-hint mt-2"
        role="status"
      >
        {{ resendMessage }}
      </p>
    </div>

    <p class="mt-6 text-center text-sm text-[var(--color-ink-500)]">
      Already confirmed?
      <NuxtLink
        to="/login"
        class="font-semibold text-[var(--color-blue-500)]"
      >
        Sign in
      </NuxtLink>
    </p>
  </div>

  <div v-else>
    <AuthHeader
      title="Create your account"
      subtitle="Driver self-registration"
    />

    <form
      class="card p-4"
      novalidate
      @submit.prevent="submit"
    >
      <p
        v-if="errorMessage"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ errorMessage }}</span>
      </p>

      <div class="grid grid-cols-2 gap-3">
        <label class="field">
          <span>First name</span>
          <input
            v-model="form.firstName"
            class="input"
            :class="{ invalid: fieldErrors.firstName }"
            autocomplete="given-name"
            required
          >
          <small
            v-if="fieldErrors.firstName"
            class="field-error"
          >{{ fieldErrors.firstName }}</small>
        </label>

        <label class="field">
          <span>Last name</span>
          <input
            v-model="form.lastName"
            class="input"
            :class="{ invalid: fieldErrors.lastName }"
            autocomplete="family-name"
            required
          >
          <small
            v-if="fieldErrors.lastName"
            class="field-error"
          >{{ fieldErrors.lastName }}</small>
        </label>
      </div>

      <label class="field">
        <span>Mobile number</span>
        <input
          :value="form.mobileNumber"
          class="input"
          :class="{ invalid: fieldErrors.mobileNumber }"
          type="tel"
          inputmode="tel"
          autocomplete="tel"
          placeholder="(555) 123-4567"
          maxlength="14"
          required
          @input="onMobileInput"
        >
        <small
          v-if="fieldErrors.mobileNumber"
          class="field-error"
        >{{ fieldErrors.mobileNumber }}</small>
      </label>

      <PhoneVerifyField
        v-model:ticket="phoneTicket"
        v-model:ready="phoneReady"
        :mobile-number="form.mobileNumber"
        purpose="SIGNUP"
      />

      <label class="field">
        <span>Email</span>
        <input
          v-model="form.email"
          class="input"
          :class="{ invalid: fieldErrors.email }"
          type="email"
          inputmode="email"
          autocomplete="email"
          required
        >
        <small
          v-if="fieldErrors.email"
          class="field-error"
        >{{ fieldErrors.email }}</small>
      </label>

      <label class="field">
        <span>Password</span>
        <input
          v-model="form.password"
          class="input"
          :class="{ invalid: fieldErrors.password }"
          type="password"
          autocomplete="new-password"
          required
        >
        <small class="field-hint">At least 10 characters.</small>
        <small
          v-if="fieldErrors.password"
          class="field-error"
        >{{ fieldErrors.password }}</small>
      </label>

      <label class="field">
        <span>Company invite code</span>
        <input
          v-model="form.inviteCode"
          class="input mono"
          :class="{ invalid: fieldErrors.inviteCode }"
          autocomplete="one-time-code"
          required
        >
        <small class="field-hint">Ask your dispatcher or administrator for the code.</small>
        <small
          v-if="fieldErrors.inviteCode"
          class="field-error"
        >{{ fieldErrors.inviteCode }}</small>
      </label>

      <button
        class="btn-primary-action"
        type="submit"
        :disabled="submitting || !phoneReady"
      >
        {{ submitting ? 'Creating account…' : 'Create driver account' }}
      </button>
    </form>

    <p class="mt-6 text-center text-sm text-[var(--color-ink-500)]">
      Already registered?
      <NuxtLink
        to="/login"
        class="font-semibold text-[var(--color-blue-500)]"
      >
        Sign in
      </NuxtLink>
    </p>
  </div>
</template>
