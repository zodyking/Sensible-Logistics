<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Confirming your email' })

const route = useRoute()
const { fetch: refreshSession } = useUserSession()

const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))

type State = 'working' | 'failed'
const state = ref<State>('working')
const errorMessage = ref('')

/** Resend, offered when the link has expired. */
const email = ref('')
const resending = ref(false)
const resendMessage = ref('')

async function verify() {
  if (!token.value) {
    state.value = 'failed'
    errorMessage.value = 'This link is missing its verification code. Request a new email below.'
    return
  }

  try {
    const result = await $fetch('/api/auth/verify-email', {
      method: 'POST',
      body: { token: token.value },
    })
    await refreshSession()
    // A successful link signs the driver in, so go straight to their work.
    await navigateTo(result.redirectTo)
  }
  catch (error) {
    state.value = 'failed'
    errorMessage.value = apiErrorMessage(error, 'This verification link is invalid or has expired.')
  }
}

async function resend() {
  if (resending.value) return
  resending.value = true
  resendMessage.value = ''

  try {
    const result = await $fetch('/api/auth/resend-verification', {
      method: 'POST',
      body: { email: email.value },
    })
    resendMessage.value = result.message
  }
  catch (error) {
    resendMessage.value = apiErrorMessage(error, 'Could not resend the link.')
  }
  finally {
    resending.value = false
  }
}

onMounted(verify)
</script>

<template>
  <div>
    <AuthHeader
      :title="state === 'working' ? 'Confirming your email' : 'Link not valid'"
      subtitle="Email confirmation"
    />

    <div class="card p-4">
      <p
        v-if="state === 'working'"
        class="text-[15px]"
        role="status"
      >
        Checking your confirmation link…
      </p>

      <template v-else>
        <p
          class="banner err"
          role="alert"
        >
          <span aria-hidden="true">✕</span>
          <span>{{ errorMessage }}</span>
        </p>

        <p class="field-hint mt-3">
          Enter your email address and we will send a new confirmation link.
        </p>

        <form
          class="mt-3"
          novalidate
          @submit.prevent="resend"
        >
          <label class="field">
            <span>Email</span>
            <input
              v-model="email"
              class="input"
              type="email"
              autocomplete="email"
              inputmode="email"
              required
            >
          </label>

          <button
            class="btn-primary-action mt-2"
            type="submit"
            :disabled="resending"
          >
            {{ resending ? 'Sending…' : 'Send a new link' }}
          </button>
        </form>

        <p
          v-if="resendMessage"
          class="field-hint mt-2"
          role="status"
        >
          {{ resendMessage }}
        </p>
      </template>
    </div>

    <p class="mt-6 text-center text-sm text-[var(--color-ink-500)]">
      <NuxtLink
        to="/login"
        class="font-semibold text-[var(--color-blue-500)]"
      >
        Back to sign in
      </NuxtLink>
    </p>
  </div>
</template>
