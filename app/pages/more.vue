<script setup lang="ts">
useHead({ title: 'More' })

const { user, clear, fetch: refreshSession } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')

const isDriver = computed(() => user.value?.role === 'DRIVER')
const { data: home } = await useFetch('/api/home', { immediate: isDriver.value })
const { data: features, refresh: refreshFeatures } = await useFetch('/api/features')
const unlocked = ref<string[]>(features.value?.unlocked ?? [])
watch(() => features.value?.unlocked, (next) => {
  if (next) unlocked.value = [...next]
}, { immediate: true })

const pendingSync = useState('pending-sync', () => 0)
watchEffect(() => {
  const events = home.value?.pendingSync.events ?? 0
  const photos = home.value?.pendingSync.photos ?? 0
  pendingSync.value = events + photos
})

const initials = computed(() =>
  `${user.value?.firstName?.[0] ?? ''}${user.value?.lastName?.[0] ?? ''}`.toUpperCase() || '—',
)

const onTrip = computed(() => Boolean(home.value?.active))
const signingOut = ref(false)
const systemCode = ref('')
const codeBusy = ref(false)
const codeFlash = ref('')

const showConnections = computed(() => unlocked.value.includes('CONNECTIONS'))
const showReset = computed(() => unlocked.value.includes('RESET'))

async function submitCode() {
  if (codeBusy.value) return
  const code = systemCode.value.trim()
  if (!code) return
  codeBusy.value = true
  codeFlash.value = ''
  try {
    const result = await $fetch('/api/features/unlock', {
      method: 'POST',
      body: { code },
    })
    systemCode.value = ''
    codeFlash.value = result.enabled ? 'On' : 'Off'
    await Promise.all([refreshFeatures(), refreshSession()])
    unlocked.value = [...result.unlocked]
  }
  catch (error) {
    codeFlash.value = apiErrorMessage(error, 'That code did not match.')
  }
  finally {
    codeBusy.value = false
  }
}

async function signOut() {
  signingOut.value = true
  await $fetch('/api/auth/logout', { method: 'POST' })
  await clear()
  await navigateTo('/login', { replace: true })
}
</script>

<template>
  <section class="d-page">
    <span class="eyebrow">Account</span>
    <h1 class="d-title">
      More
    </h1>
    <div class="card rowlist">
      <div class="row">
        <div class="av">
          {{ initials }}
        </div>
        <div class="row-main">
          <b>{{ user?.fullName }}</b>
          <small>{{ user?.role === 'ADMIN' ? 'Admin' : 'Driver' }} · {{ user?.companyName }}</small>
        </div>
        <div class="row-end">
          <StatusChip
            v-if="isDriver"
            :variant="onTrip ? 'ok' : 'idle'"
            :label="onTrip ? 'On Trip' : 'Off Duty'"
          />
        </div>
      </div>
      <NuxtLink
        v-if="isDriver"
        to="/locations"
        class="row"
      >
        <div
          class="row-ico"
          aria-hidden="true"
        >
          ◫
        </div>
        <div class="row-main">
          <b>Customers & locations</b>
          <small>Company-wide yards, terminals, and customers</small>
        </div>
        <div
          class="row-end"
          aria-hidden="true"
        >
          ›
        </div>
      </NuxtLink>
      <NuxtLink
        v-if="isDriver"
        to="/documents"
        class="row"
      >
        <div
          class="row-ico"
          aria-hidden="true"
        >
          ▤
        </div>
        <div class="row-main">
          <b>My Documents</b>
          <small>EIRs, PODs, gate tickets</small>
        </div>
        <div
          class="row-end"
          aria-hidden="true"
        >
          ›
        </div>
      </NuxtLink>
      <div
        v-if="isDriver"
        class="row"
      >
        <div
          class="row-ico"
          aria-hidden="true"
        >
          ⇅
        </div>
        <div class="row-main">
          <b>Pending Sync</b>
          <small>
            {{ pendingSync === 0 ? 'All work is synced' : `${pendingSync} item${pendingSync === 1 ? '' : 's'} queued` }}
          </small>
        </div>
        <div class="row-end">
          <StatusChip
            v-if="pendingSync > 0"
            variant="warn"
            :label="String(pendingSync)"
          />
        </div>
      </div>
      <NuxtLink
        v-if="isDriver"
        to="/settings"
        class="row"
      >
        <div
          class="row-ico"
          aria-hidden="true"
        >
          ⚙
        </div>
        <div class="row-main">
          <b>Settings</b>
          <small>Name, email, password, and phone</small>
        </div>
        <div
          class="row-end"
          aria-hidden="true"
        >
          ›
        </div>
      </NuxtLink>
      <NuxtLink
        v-if="showConnections"
        to="/connections"
        class="row"
      >
        <div
          class="row-ico"
          aria-hidden="true"
        >
          ⌁
        </div>
        <div class="row-main">
          <b>API connections</b>
          <small>App-wide credentials and settings</small>
        </div>
        <div
          class="row-end"
          aria-hidden="true"
        >
          ›
        </div>
      </NuxtLink>
      <NuxtLink
        v-if="showReset"
        to="/reset"
        class="row"
      >
        <div
          class="row-ico"
          aria-hidden="true"
        >
          ⌫
        </div>
        <div class="row-main">
          <b>Clear records</b>
          <small>Delete company data by type</small>
        </div>
        <div
          class="row-end"
          aria-hidden="true"
        >
          ›
        </div>
      </NuxtLink>
    </div>

    <p class="section-label">
      System code
    </p>
    <form
      class="card p-4"
      novalidate
      @submit.prevent="submitCode"
    >
      <div class="system-code">
        <label
          class="sr-only"
          for="system-code"
        >System code</label>
        <input
          id="system-code"
          v-model="systemCode"
          class="input mono"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          maxlength="40"
        >
        <button
          class="btn-dark system-code-go"
          type="submit"
          :disabled="codeBusy || !systemCode.trim()"
        >
          {{ codeBusy ? '…' : 'Enter' }}
        </button>
      </div>
      <p
        v-if="codeFlash"
        class="field-hint mt-2"
        role="status"
      >
        {{ codeFlash }}
      </p>
    </form>

    <button
      class="btn-ghost mt-5 w-full"
      :disabled="signingOut"
      @click="signOut"
    >
      {{ signingOut ? 'Signing out…' : 'Sign out' }}
    </button>
  </section>
</template>
