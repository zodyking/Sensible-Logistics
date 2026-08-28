<script setup lang="ts">
useHead({ title: 'More' })

const { user, clear } = useUserSession()
const { data: home } = await useFetch('/api/home')

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
          <small>Driver · {{ user?.companyName }}</small>
        </div>
        <div class="row-end">
          <StatusChip
            :variant="onTrip ? 'ok' : 'idle'"
            :label="onTrip ? 'On Trip' : 'Off Duty'"
          />
        </div>
      </div>
      <NuxtLink
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
      <div class="row">
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
          <small>Profile, truck, notifications</small>
        </div>
        <div
          class="row-end"
          aria-hidden="true"
        >
          ›
        </div>
      </NuxtLink>
    </div>

    <button
      class="btn-ghost mt-5 w-full"
      :disabled="signingOut"
      @click="signOut"
    >
      {{ signingOut ? 'Signing out…' : 'Sign out' }}
    </button>
  </section>
</template>
