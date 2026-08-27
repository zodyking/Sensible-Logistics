<script setup lang="ts">
import { LOCATION_TYPE_LABELS } from '#shared/utils/domain'

useHead({ title: 'Home' })

const { data, status, error, refresh } = await useFetch('/api/home')

const pendingSync = useState('pending-sync', () => 0)
watchEffect(() => {
  pendingSync.value = (data.value?.pendingSync.events ?? 0) + (data.value?.pendingSync.photos ?? 0)
})

const active = computed(() => data.value?.active)

const sheet = ref<'dropoff' | 'documents' | 'sms' | 'contacts' | 'cancel' | null>(null)
const locationSearch = ref('')
const selectedDestinationId = ref<string | null>(null)
const savingDropoff = ref(false)
const dropoffError = ref('')
const cancelling = ref(false)
const cancelError = ref('')

const { data: locationData } = await useFetch('/api/locations', {
  query: computed(() => ({ q: locationSearch.value || undefined, limit: 50 })),
})

watch(active, (value) => {
  selectedDestinationId.value = value?.destination?.id ?? null
}, { immediate: true })

const filteredLocations = computed(() => locationData.value?.items ?? [])

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

async function saveDropoff() {
  if (!active.value || !selectedDestinationId.value) return
  savingDropoff.value = true
  dropoffError.value = ''
  try {
    await $fetch(`/api/trips/${active.value.trip.id}/destination`, {
      method: 'POST',
      body: { destinationLocationId: selectedDestinationId.value },
    })
    sheet.value = null
    await refresh()
  }
  catch (err) {
    dropoffError.value = apiErrorMessage(err, 'Could not change drop-off.')
  }
  finally {
    savingDropoff.value = false
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
        :container-type="active.container?.containerType"
        :is-loaded="active.trip.isLoaded"
        :container-number="active.container?.number"
        :equipment-type="active.container?.equipmentType"
        :chassis-number="active.chassis?.number"
        :seal-number="active.trip.sealNumber"
        :origin-name="active.origin?.name"
        :destination-name="active.destination?.name"
        can-change-dropoff
        @change-dropoff="sheet = 'dropoff'"
      />

      <div
        v-else
        class="trip-card"
      >
        <div class="trip-card-head">
          <div class="trip-card-meta">
            <span class="trip-flag line">None</span>
            <span class="trip-flag empty">Bob Tail</span>
          </div>
          <div class="trip-cno">
            No active trip
          </div>
          <p class="text-center text-sm text-[var(--color-ink-500)]">
            Start a pickup to put a container on this card.
          </p>
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
      :open="sheet === 'dropoff'"
      title="Change drop-off location"
      @close="sheet = null"
    >
      <p
        v-if="dropoffError"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ dropoffError }}</span>
      </p>
      <div class="sheet-search">
        ⌕
        <input
          v-model="locationSearch"
          type="search"
          placeholder="Search yards, customers, terminals…"
          aria-label="Search drop-off locations"
        >
      </div>
      <button
        v-for="location in filteredLocations"
        :key="location.id"
        type="button"
        class="sheet-loc"
        :class="{ sel: selectedDestinationId === location.id }"
        @click="selectedDestinationId = location.id"
      >
        <b>{{ location.name }}</b>
        <small>
          {{ LOCATION_TYPE_LABELS[location.type] }}
          <template v-if="location.addressLine1"> · {{ location.addressLine1 }}</template>
          <template v-if="location.city"> · {{ location.city }}</template>
        </small>
      </button>
      <div class="sheet-actions">
        <button
          type="button"
          class="btn-cancel"
          @click="sheet = null"
        >
          Cancel
        </button>
        <button
          type="button"
          class="btn-save"
          :disabled="!selectedDestinationId || savingDropoff"
          @click="saveDropoff"
        >
          {{ savingDropoff ? 'Saving…' : 'Save location' }}
        </button>
      </div>
    </BottomSheet>

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
        Cancel this trip? You will go back to no active trip. The container stays in the pool.
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
