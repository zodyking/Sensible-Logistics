<script setup lang="ts">
import { formatPhoneDisplay, formatPhoneInput } from '#shared/utils/phone'

useHead({ title: 'Settings' })

const { user, fetch: refreshSession } = useUserSession()
const { data: profile, refresh: refreshProfile } = await useFetch('/api/account')

const firstName = ref('')
const lastName = ref('')

watch(profile, (value) => {
  if (!value) return
  firstName.value = value.firstName
  lastName.value = value.lastName
}, { immediate: true })

const nameDirty = computed(() => {
  if (!profile.value) return false
  return firstName.value.trim() !== profile.value.firstName
    || lastName.value.trim() !== profile.value.lastName
})

const savingName = ref(false)
const nameError = ref('')
const nameFieldErrors = ref<Record<string, string>>({})
const flash = ref('')

type Sheet = 'email' | 'password' | 'phone' | null
const sheet = ref<Sheet>(null)

const emailForm = reactive({ email: '', currentPassword: '' })
const passwordForm = reactive({ currentPassword: '', password: '', confirm: '' })
const phoneForm = reactive({ mobileNumber: '', currentPassword: '' })

const sheetBusy = ref(false)
const sheetError = ref('')
const sheetFieldErrors = ref<Record<string, string>>({})

const phoneDisplay = computed(() => formatPhoneDisplay(profile.value?.mobileNumber) || 'Add a mobile number')

function fieldIssues(error: unknown): Record<string, string> {
  const issues = (error as { data?: { data?: { issues?: Array<{ path: string, message: string }> } } })
    .data?.data?.issues
  if (!issues?.length) return {}
  return Object.fromEntries(issues.map(issue => [issue.path, issue.message]))
}

function openSheet(next: Exclude<Sheet, null>) {
  sheetError.value = ''
  sheetFieldErrors.value = {}
  emailForm.email = ''
  emailForm.currentPassword = ''
  passwordForm.currentPassword = ''
  passwordForm.password = ''
  passwordForm.confirm = ''
  phoneForm.currentPassword = ''
  phoneForm.mobileNumber = formatPhoneInput(profile.value?.mobileNumber)
  sheet.value = next
}

function onPhoneInput(event: Event) {
  const input = event.target as HTMLInputElement
  const formatted = formatPhoneInput(input.value)
  phoneForm.mobileNumber = formatted
  if (input.value !== formatted) input.value = formatted
}

async function afterSave(message: string) {
  flash.value = message
  sheet.value = null
  await Promise.all([refreshProfile(), refreshSession()])
}

async function saveName() {
  if (savingName.value || !nameDirty.value) return
  savingName.value = true
  nameError.value = ''
  nameFieldErrors.value = {}

  try {
    await $fetch('/api/account/profile', {
      method: 'PATCH',
      body: { firstName: firstName.value, lastName: lastName.value },
    })
    await afterSave('Name updated.')
  }
  catch (error) {
    nameFieldErrors.value = fieldIssues(error)
    nameError.value = Object.keys(nameFieldErrors.value).length
      ? 'Check the highlighted fields.'
      : apiErrorMessage(error, 'Could not save your name.')
  }
  finally {
    savingName.value = false
  }
}

async function saveEmail() {
  if (sheetBusy.value) return
  sheetBusy.value = true
  sheetError.value = ''
  sheetFieldErrors.value = {}

  try {
    await $fetch('/api/account/email', {
      method: 'POST',
      body: { email: emailForm.email, currentPassword: emailForm.currentPassword },
    })
    await afterSave('Email updated. Use the new address the next time you sign in.')
  }
  catch (error) {
    sheetFieldErrors.value = fieldIssues(error)
    sheetError.value = Object.keys(sheetFieldErrors.value).length
      ? 'Check the highlighted fields.'
      : apiErrorMessage(error, 'Could not change your email.')
  }
  finally {
    sheetBusy.value = false
  }
}

async function savePassword() {
  if (sheetBusy.value) return
  sheetBusy.value = true
  sheetError.value = ''
  sheetFieldErrors.value = {}

  if (passwordForm.password !== passwordForm.confirm) {
    sheetFieldErrors.value = { confirm: 'Passwords do not match.' }
    sheetError.value = 'Check the highlighted fields.'
    sheetBusy.value = false
    return
  }

  try {
    await $fetch('/api/account/password', {
      method: 'POST',
      body: {
        currentPassword: passwordForm.currentPassword,
        password: passwordForm.password,
      },
    })
    await afterSave('Password updated.')
  }
  catch (error) {
    sheetFieldErrors.value = fieldIssues(error)
    sheetError.value = Object.keys(sheetFieldErrors.value).length
      ? 'Check the highlighted fields.'
      : apiErrorMessage(error, 'Could not set a new password.')
  }
  finally {
    sheetBusy.value = false
  }
}

async function savePhone() {
  if (sheetBusy.value) return
  sheetBusy.value = true
  sheetError.value = ''
  sheetFieldErrors.value = {}

  try {
    await $fetch('/api/account/phone', {
      method: 'POST',
      body: {
        mobileNumber: phoneForm.mobileNumber,
        currentPassword: phoneForm.currentPassword,
      },
    })
    await afterSave('Phone number updated.')
  }
  catch (error) {
    sheetFieldErrors.value = fieldIssues(error)
    sheetError.value = Object.keys(sheetFieldErrors.value).length
      ? 'Check the highlighted fields.'
      : apiErrorMessage(error, 'Could not change your phone number.')
  }
  finally {
    sheetBusy.value = false
  }
}
</script>

<template>
  <section class="d-page">
    <PageHeader
      eyebrow="Account"
      title="Settings"
      back-to="/more"
      back-label="More"
    />

    <p
      v-if="flash"
      class="banner ok"
      role="status"
    >
      <span aria-hidden="true">✓</span>
      <span>{{ flash }}</span>
    </p>

    <p class="section-label !mt-2">
      Profile
    </p>
    <form
      class="card p-4"
      novalidate
      @submit.prevent="saveName"
    >
      <p
        v-if="nameError"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ nameError }}</span>
      </p>

      <div class="settings-name-grid">
        <label class="field">
          <span>First name</span>
          <input
            v-model="firstName"
            class="input"
            :class="{ invalid: nameFieldErrors.firstName }"
            autocomplete="given-name"
            required
          >
          <small
            v-if="nameFieldErrors.firstName"
            class="field-error"
          >{{ nameFieldErrors.firstName }}</small>
        </label>
        <label class="field">
          <span>Last name</span>
          <input
            v-model="lastName"
            class="input"
            :class="{ invalid: nameFieldErrors.lastName }"
            autocomplete="family-name"
            required
          >
          <small
            v-if="nameFieldErrors.lastName"
            class="field-error"
          >{{ nameFieldErrors.lastName }}</small>
        </label>
      </div>

      <div class="settings-company">
        <span>Company</span>
        <b>{{ profile?.companyName || user?.companyName }}</b>
      </div>

      <button
        class="btn-dark mt-4"
        type="submit"
        :disabled="savingName || !nameDirty"
      >
        {{ savingName ? 'Saving…' : 'Save name' }}
      </button>
    </form>

    <p class="section-label">
      Contact
    </p>
    <div class="card rowlist">
      <button
        type="button"
        class="row"
        @click="openSheet('phone')"
      >
        <div
          class="row-ico"
          aria-hidden="true"
        >
          ☎
        </div>
        <div class="row-main">
          <b>Phone number</b>
          <small>{{ phoneDisplay }}</small>
        </div>
        <div class="row-end">
          Change ›
        </div>
      </button>
      <button
        type="button"
        class="row"
        @click="openSheet('email')"
      >
        <div
          class="row-ico"
          aria-hidden="true"
        >
          @
        </div>
        <div class="row-main">
          <b>Email</b>
          <small class="settings-break">{{ profile?.email || user?.email }}</small>
        </div>
        <div class="row-end">
          Change ›
        </div>
      </button>
    </div>

    <p class="section-label">
      Security
    </p>
    <div class="card rowlist">
      <button
        type="button"
        class="row"
        @click="openSheet('password')"
      >
        <div
          class="row-ico"
          aria-hidden="true"
        >
          ⌁
        </div>
        <div class="row-main">
          <b>Password</b>
          <small>Set a new sign-in password</small>
        </div>
        <div class="row-end">
          Change ›
        </div>
      </button>
    </div>

    <BottomSheet
      :open="sheet === 'phone'"
      title="Change phone number"
      @close="sheet = null"
    >
      <form
        novalidate
        @submit.prevent="savePhone"
      >
        <p
          v-if="sheetError"
          class="banner err"
          role="alert"
        >
          <span aria-hidden="true">✕</span>
          <span>{{ sheetError }}</span>
        </p>
        <label class="field">
          <span>Mobile number</span>
          <input
            :value="phoneForm.mobileNumber"
            class="input"
            :class="{ invalid: sheetFieldErrors.mobileNumber }"
            type="tel"
            inputmode="tel"
            autocomplete="tel"
            placeholder="(555) 123-4567"
            maxlength="14"
            required
            @input="onPhoneInput"
          >
          <small class="field-hint">10-digit US number, same as signup.</small>
          <small
            v-if="sheetFieldErrors.mobileNumber"
            class="field-error"
          >{{ sheetFieldErrors.mobileNumber }}</small>
        </label>
        <label class="field">
          <span>Current password</span>
          <input
            v-model="phoneForm.currentPassword"
            class="input"
            :class="{ invalid: sheetFieldErrors.currentPassword }"
            type="password"
            autocomplete="current-password"
            required
          >
          <small
            v-if="sheetFieldErrors.currentPassword"
            class="field-error"
          >{{ sheetFieldErrors.currentPassword }}</small>
        </label>
        <div class="sheet-actions">
          <button
            type="button"
            class="btn-cancel"
            :disabled="sheetBusy"
            @click="sheet = null"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="btn-save"
            :disabled="sheetBusy"
          >
            {{ sheetBusy ? 'Saving…' : 'Save number' }}
          </button>
        </div>
      </form>
    </BottomSheet>

    <BottomSheet
      :open="sheet === 'email'"
      title="Change email"
      @close="sheet = null"
    >
      <form
        novalidate
        @submit.prevent="saveEmail"
      >
        <p
          v-if="sheetError"
          class="banner err"
          role="alert"
        >
          <span aria-hidden="true">✕</span>
          <span>{{ sheetError }}</span>
        </p>
        <label class="field">
          <span>New email</span>
          <input
            v-model="emailForm.email"
            class="input"
            :class="{ invalid: sheetFieldErrors.email }"
            type="email"
            inputmode="email"
            autocomplete="email"
            required
          >
          <small class="field-hint">This becomes your sign-in address.</small>
          <small
            v-if="sheetFieldErrors.email"
            class="field-error"
          >{{ sheetFieldErrors.email }}</small>
        </label>
        <label class="field">
          <span>Current password</span>
          <input
            v-model="emailForm.currentPassword"
            class="input"
            :class="{ invalid: sheetFieldErrors.currentPassword }"
            type="password"
            autocomplete="current-password"
            required
          >
          <small
            v-if="sheetFieldErrors.currentPassword"
            class="field-error"
          >{{ sheetFieldErrors.currentPassword }}</small>
        </label>
        <div class="sheet-actions">
          <button
            type="button"
            class="btn-cancel"
            :disabled="sheetBusy"
            @click="sheet = null"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="btn-save"
            :disabled="sheetBusy"
          >
            {{ sheetBusy ? 'Saving…' : 'Save email' }}
          </button>
        </div>
      </form>
    </BottomSheet>

    <BottomSheet
      :open="sheet === 'password'"
      title="Set new password"
      @close="sheet = null"
    >
      <form
        novalidate
        @submit.prevent="savePassword"
      >
        <p
          v-if="sheetError"
          class="banner err"
          role="alert"
        >
          <span aria-hidden="true">✕</span>
          <span>{{ sheetError }}</span>
        </p>
        <label class="field">
          <span>Current password</span>
          <input
            v-model="passwordForm.currentPassword"
            class="input"
            :class="{ invalid: sheetFieldErrors.currentPassword }"
            type="password"
            autocomplete="current-password"
            required
          >
          <small
            v-if="sheetFieldErrors.currentPassword"
            class="field-error"
          >{{ sheetFieldErrors.currentPassword }}</small>
        </label>
        <label class="field">
          <span>New password</span>
          <input
            v-model="passwordForm.password"
            class="input"
            :class="{ invalid: sheetFieldErrors.password }"
            type="password"
            autocomplete="new-password"
            required
          >
          <small class="field-hint">At least 10 characters.</small>
          <small
            v-if="sheetFieldErrors.password"
            class="field-error"
          >{{ sheetFieldErrors.password }}</small>
        </label>
        <label class="field">
          <span>Confirm new password</span>
          <input
            v-model="passwordForm.confirm"
            class="input"
            :class="{ invalid: sheetFieldErrors.confirm }"
            type="password"
            autocomplete="new-password"
            required
          >
          <small
            v-if="sheetFieldErrors.confirm"
            class="field-error"
          >{{ sheetFieldErrors.confirm }}</small>
        </label>
        <div class="sheet-actions">
          <button
            type="button"
            class="btn-cancel"
            :disabled="sheetBusy"
            @click="sheet = null"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="btn-save"
            :disabled="sheetBusy"
          >
            {{ sheetBusy ? 'Saving…' : 'Save password' }}
          </button>
        </div>
      </form>
    </BottomSheet>
  </section>
</template>
