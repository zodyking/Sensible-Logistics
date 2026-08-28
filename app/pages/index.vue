<script setup lang="ts">
useHead({ title: 'Home' })

const { data, status, error, refresh } = await useFetch('/api/home')

const pendingSync = useState('pending-sync', () => 0)
watchEffect(() => {
  pendingSync.value = (data.value?.pendingSync.events ?? 0) + (data.value?.pendingSync.photos ?? 0)
})

const active = computed(() => data.value?.active)

const sheet = ref<'documents' | 'sms' | 'contacts' | 'cancel' | null>(null)
const cancelling = ref(false)
const cancelError = ref('')

const canAttachContainer = computed(() =>
  Boolean(
    active.value
    && active.value.chassis
    && !active.value.container
    && active.value.trip.status !== 'PICKUP_IN_PROGRESS',
  ),
)

const cancelCopy = computed(() => {
  if (active.value && !active.value.container) {
    return 'Cancel this trip? You will go back to no active trip. The chassis returns to available.'
  }
  return 'Cancel this trip? You will go back to no active trip. The container stays in the pool.'
})

const primaryAction = computed(() => {
  if (!active.value) return { label: 'New Pickup', to: '/pickups/new' }
  return active.value.primaryAction
})

async function confirmCancelTrip() {
  if (!active.value || cancelling.value) return
  cancelling.value = true
  cancelError.value = ''
  try {
    await $fetch(`/api/trips/${active.value.trip.id}/cancel`, {
      method: 'POST',
      body: {
        eventId: crypto.randomUUID(),
        reason: 'Driver cancelled from Home.',
      },
    })
    sheet.value = null
    await refresh()
  }
  catch (err) {
    cancelError.value = apiErrorMessage(err, 'Could not cancel the trip.')
  }
  finally {
    cancelling.value = false
  }
}
</script>

<template>
  <section class="d-page">
    <div
      v-if="status === 'pending'"
      class="card p-6 text-center text-sm text-[var(--color-ink-500)]"
      role="status"
    >
      Loading your day…
    </div>

    <p
      v-else-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>
        <b>Could not load the dashboard</b>
        {{ apiErrorMessage(error) }}
      </span>
    </p>

    <template v-else-if="data">
      <header class="home-mast">
        <p class="home-hello">
          Hello {{ data.driver.firstName }}
        </p>
        <div class="home-tally">
          <div class="home-tally-card">
            <small>Bridge Crosses</small>
            <b>{{ data.stats.bridgeCrosses }}</b>
          </div>
          <div class="home-tally-card">
            <small>Swaps</small>
            <b>{{ data.stats.swaps }}</b>
          </div>
        </div>
      </header>

      <TripCard
        v-if="active"
        :trip-kind="active.trip.kind === 'BARE_CHASSIS' ? 'BARE_CHASSIS' : 'CONTAINER'"
        :container-type="active.container?.containerType"
        :is-loaded="active.trip.isLoaded"
        :container-number="active.container?.number"
        :equipment-type="active.container?.equipmentType"
        :chassis-number="active.chassis?.number"
        :seal-number="active.trip.sealNumber"
        :origin-name="active.origin?.name"
        :destination-name="active.destination?.name"
        :status="active.trip.status"
        can-change-dropoff
        @change-dropoff="navigateTo(`/trips/${active.trip.id}/dropoff`)"
      />

      <div
        v-else
        class="trip-card"
      >
        <div class="trip-card-head">
          <div class="trip-card-meta">
            <div class="trip-card-flags">
              <span class="trip-flag line">None</span>
              <span class="trip-flag empty">Bob tail</span>
            </div>
          </div>
          <div class="trip-cno">
            No active trip
          </div>
          <p class="mb-0 text-sm text-[var(--color-ink-500)]">
            Start a pickup to put a container on this card.
          </p>
        </div>
        <div
          class="route-strip"
          aria-hidden="true"
        >
          <div class="route-point">
            <strong>Not set</strong>
            <small>Pickup</small>
          </div>
          <div class="route-track">
            <i class="route-dot" />
            <span class="route-line" />
            <span class="route-chevr">›</span>
            <span class="route-line" />
            <i class="route-dot" />
          </div>
          <div class="route-point dest">
            <strong>Not set</strong>
            <small>Drop-off</small>
          </div>
        </div>
      </div>

      <div class="home-actions">
        <button
          type="button"
          :disabled="!active"
          @click="sheet = 'documents'"
        >
          <span
            class="act-ico"
            aria-hidden="true"
          >▤</span>
          Documents
        </button>
        <button
          type="button"
          :disabled="!active"
          @click="sheet = 'sms'"
        >
          <span
            class="act-ico"
            aria-hidden="true"
          >✉</span>
          Send SMS
        </button>
        <button
          type="button"
          :disabled="!active"
          @click="sheet = 'contacts'"
        >
          <span
            class="act-ico"
            aria-hidden="true"
          >☎</span>
          Contacts
        </button>
        <NuxtLink
          v-if="active"
          :to="`/trips/${active.trip.id}`"
        >
          <span
            class="act-ico"
            aria-hidden="true"
          >☰</span>
          Trip Details
        </NuxtLink>
        <button
          v-else
          type="button"
          disabled
        >
          <span
            class="act-ico"
            aria-hidden="true"
          >☰</span>
          Trip Details
        </button>
      </div>

      <div class="home-ctas">
        <NuxtLink
          :to="primaryAction.to"
          class="btn-primary-action home-cta"
        >
          {{ primaryAction.label }}
        </NuxtLink>
        <NuxtLink
          v-if="canAttachContainer"
          to="/pickups/attach"
          class="btn-dark home-cta"
        >
          Add container to chassis
        </NuxtLink>
        <button
          v-if="active"
          type="button"
          class="btn-cancel-trip"
          @click="sheet = 'cancel'"
        >
          Cancel Trip
        </button>
      </div>
    </template>

    <BottomSheet
      :open="sheet === 'documents'"
      title="Trip documents"
      @close="sheet = null"
    >
      <p class="text-sm text-[var(--color-ink-500)]">
        EIRs, PODs and gate tickets attach to this movement once object storage is on. Nothing is queued for this trip yet.
      </p>
      <div class="sheet-actions">
        <button
          type="button"
          class="btn-cancel"
          @click="sheet = null"
        >
          Close
        </button>
      </div>
    </BottomSheet>

    <BottomSheet
      :open="sheet === 'sms'"
      title="Send SMS"
      @close="sheet = null"
    >
      <p class="text-sm text-[var(--color-ink-500)]">
        Dispatch SMS from this trip is not wired yet. Use your phone’s messages app for now.
      </p>
      <div class="sheet-actions">
        <button
          type="button"
          class="btn-cancel"
          @click="sheet = null"
        >
          Close
        </button>
      </div>
    </BottomSheet>

    <BottomSheet
      :open="sheet === 'contacts'"
      title="Contacts"
      @close="sheet = null"
    >
      <p class="text-sm text-[var(--color-ink-500)]">
        Terminal, customer and dispatch contacts will live here. None are on file for this trip yet.
      </p>
      <div class="sheet-actions">
        <button
          type="button"
          class="btn-cancel"
          @click="sheet = null"
        >
          Close
        </button>
      </div>
    </BottomSheet>

    <BottomSheet
      :open="sheet === 'cancel'"
      title="Cancel Trip"
      @close="sheet = null"
    >
      <p
        v-if="cancelError"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ cancelError }}</span>
      </p>
      <p class="text-sm text-[var(--color-ink-700)]">
        {{ cancelCopy }}
      </p>
      <div class="sheet-actions">
        <button
          type="button"
          class="btn-cancel"
          :disabled="cancelling"
          @click="sheet = null"
        >
          Keep Trip
        </button>
        <button
          type="button"
          class="btn-save danger"
          :disabled="cancelling"
          @click="confirmCancelTrip"
        >
          {{ cancelling ? 'Cancelling…' : 'Cancel Trip' }}
        </button>
      </div>
    </BottomSheet>
  </section>
</template>
