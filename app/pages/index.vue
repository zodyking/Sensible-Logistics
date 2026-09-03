<script setup lang="ts">
import { canStartSwap, tripSmsAction } from '#shared/utils/trip-sms'
import { invalidateTripLists } from '~/utils/trip-lists'

useHead({ title: 'Home' })

const { data, status, error, refresh } = await useFetch('/api/home')

const pendingSync = useState('pending-sync', () => 0)
watchEffect(() => {
  pendingSync.value = (data.value?.pendingSync.events ?? 0) + (data.value?.pendingSync.photos ?? 0)
})

const active = computed(() => data.value?.active)
const swapPartner = computed(() => data.value?.swapPartner ?? null)
const todayTasks = computed(() => data.value?.todayTasks ?? [])
const CLEARED_HOME_TRIP_KEY = 'sensible-home-cleared-trip'
const clearedTripId = ref<string | null>(null)

onMounted(() => {
  try {
    clearedTripId.value = localStorage.getItem(CLEARED_HOME_TRIP_KEY)
  }
  catch {
    clearedTripId.value = null
  }
})

const displayTrip = computed(() => {
  if (data.value?.active) return data.value.active
  const recent = data.value?.recentCompleted
  if (!recent) return null
  if (clearedTripId.value && recent.trip.id === clearedTripId.value) return null
  return recent
})

const canClearDashboard = computed(() => Boolean(!active.value && displayTrip.value))

function clearDashboard() {
  const id = data.value?.recentCompleted?.trip.id
  if (!id) return
  clearedTripId.value = id
  try {
    localStorage.setItem(CLEARED_HOME_TRIP_KEY, id)
  }
  catch {
    // Still hides the completed card for this session.
  }
}

const sheet = ref<'documents' | 'sms' | 'contacts' | 'cancel' | null>(null)
const cancelling = ref(false)
const cancelError = ref('')

const inSwap = computed(() => Boolean(active.value && swapPartner.value))

const loadTrip = computed(() => {
  if (active.value?.trip.isLoaded) return active.value
  if (swapPartner.value?.trip.isLoaded) return swapPartner.value
  return null
})

const emptyTrip = computed(() => {
  if (active.value && !active.value.trip.isLoaded && active.value.trip.kind !== 'BARE_CHASSIS') return active.value
  if (swapPartner.value && !swapPartner.value.trip.isLoaded) return swapPartner.value
  return null
})

const swapSmsReady = computed(() => Boolean(
  loadTrip.value
  && emptyTrip.value
  && tripSmsAction(loadTrip.value.trip.status)
  && tripSmsAction(emptyTrip.value.trip.status),
))

const canSendSms = computed(() =>
  swapSmsReady.value || Boolean(displayTrip.value && tripSmsAction(displayTrip.value.trip.status)),
)

const documentsTripId = computed(() => loadTrip.value?.trip.id ?? displayTrip.value?.trip.id ?? null)
const documentsTrip = computed(() => {
  const id = documentsTripId.value
  if (loadTrip.value?.trip.id === id) return loadTrip.value
  if (displayTrip.value?.trip.id === id) return displayTrip.value
  return null
})

const pulseDocuments = computed(() => Boolean(
  loadTrip.value && ['IN_TRANSIT', 'DROPOFF_IN_PROGRESS', 'PICKUP_IN_PROGRESS'].includes(loadTrip.value.trip.status),
))

const canSwap = computed(() => canStartSwap({
  status: active.value?.trip.status,
  isLoaded: active.value?.trip.isLoaded,
  destinationType: active.value?.destination?.type,
  swapPairTripId: active.value?.trip.swapPairTripId,
  kind: active.value?.trip.kind,
}))

const continueSwapTo = computed(() => {
  if (swapPartner.value?.trip.status === 'PICKUP_IN_PROGRESS') {
    return `/pickups/new?trip=${swapPartner.value.trip.id}`
  }
  if (active.value?.trip.status === 'PICKUP_IN_PROGRESS' && active.value.trip.swapPairTripId) {
    return `/pickups/new?trip=${active.value.trip.id}`
  }
  return null
})

const swapTo = computed(() => {
  if (continueSwapTo.value) return continueSwapTo.value
  if (canSwap.value && active.value) return `/pickups/new?swap=${active.value.trip.id}`
  return null
})

const canAttachContainer = computed(() =>
  Boolean(
    active.value
    && !swapPartner.value
    && active.value.chassis
    && !active.value.container
    && active.value.trip.status !== 'PICKUP_IN_PROGRESS',
  ),
)

const cancelCopy = computed(() => {
  if (inSwap.value) {
    return 'Cancel the swap pickup? The empty inbound stays active.'
  }
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
  const target = inSwap.value
    ? (loadTrip.value ?? swapPartner.value ?? active.value)
    : active.value
  if (!target || cancelling.value) return
  cancelling.value = true
  cancelError.value = ''
  try {
    await $fetch(`/api/trips/${target.trip.id}/cancel`, {
      method: 'POST',
      body: {
        eventId: crypto.randomUUID(),
        reason: inSwap.value ? 'Driver cancelled the swap pickup from Home.' : 'Driver cancelled from Home.',
      },
    })
    sheet.value = null
    invalidateTripLists()
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
        v-if="displayTrip"
        :trip-kind="displayTrip.trip.kind === 'BARE_CHASSIS' ? 'BARE_CHASSIS' : 'CONTAINER'"
        :container-type="displayTrip.container?.containerType"
        :is-loaded="displayTrip.trip.isLoaded"
        :container-number="displayTrip.container?.number"
        :equipment-type="displayTrip.container?.equipmentType"
        :chassis-number="displayTrip.chassis?.number"
        :seal-number="displayTrip.trip.sealNumber"
        :origin-name="displayTrip.origin?.name"
        :destination-name="displayTrip.destination?.name"
        :status="displayTrip.trip.status"
        :can-change-dropoff="Boolean(active)"
        @change-dropoff="navigateTo(`/trips/${displayTrip.trip.id}/destination`)"
      />

      <template v-if="swapPartner">
        <p class="swap-split">
          Swap 🔁
        </p>
        <TripCard
          :trip-kind="swapPartner.trip.kind === 'BARE_CHASSIS' ? 'BARE_CHASSIS' : 'CONTAINER'"
          :container-type="swapPartner.container?.containerType"
          :is-loaded="swapPartner.trip.isLoaded"
          :container-number="swapPartner.container?.number"
          :equipment-type="swapPartner.container?.equipmentType"
          :chassis-number="swapPartner.chassis?.number"
          :seal-number="swapPartner.trip.sealNumber"
          :origin-name="swapPartner.origin?.name"
          :destination-name="swapPartner.destination?.name"
          :status="swapPartner.trip.status"
          :can-change-dropoff="swapPartner.trip.status !== 'PICKUP_IN_PROGRESS'"
          @change-dropoff="navigateTo(`/trips/${swapPartner.trip.id}/destination`)"
        />
      </template>

      <div
        v-else-if="!displayTrip"
        class="trip-card"
      >
        <div class="trip-card-head trip-card-head-idle">
          <div class="trip-cno text-center">
            No active trip
          </div>
          <p class="mb-0 text-center text-sm text-[var(--color-ink-500)]">
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
          class="home-doc-action"
          :class="{ pulse: pulseDocuments }"
          :disabled="!documentsTripId"
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
          :disabled="!canSendSms"
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
          :disabled="!displayTrip"
          @click="sheet = 'contacts'"
        >
          <span
            class="act-ico"
            aria-hidden="true"
          >☎</span>
          Contacts
        </button>
        <NuxtLink
          v-if="swapTo"
          :to="swapTo"
        >
          <span
            class="act-ico"
            aria-hidden="true"
          >🔁</span>
          Swap
        </NuxtLink>
        <button
          v-else
          type="button"
          disabled
        >
          <span
            class="act-ico"
            aria-hidden="true"
          >🔁</span>
          Swap
        </button>
      </div>

      <div class="home-ctas">
        <button
          v-if="canClearDashboard"
          type="button"
          class="btn-primary-action home-cta"
          @click="clearDashboard"
        >
          Clear Trip
        </button>
        <NuxtLink
          v-else
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

      <div
        v-if="todayTasks.length"
        class="home-dispatch"
      >
        <div class="section-label">
          <span>Dispatch</span>
          <NuxtLink to="/tasks">
            All tasks
          </NuxtLink>
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
          :steps="task.steps"
          compact
        />
      </div>
    </template>

    <TripDocumentsSheet
      :open="sheet === 'documents'"
      :trip-id="documentsTripId"
      :container-number="documentsTrip?.container?.number"
      :chassis-number="documentsTrip?.chassis?.number"
      @close="sheet = null"
    />

    <TripSmsSheet
      :open="sheet === 'sms'"
      :trip-id="displayTrip?.trip.id"
      :status="displayTrip?.trip.status"
      :is-loaded="displayTrip?.trip.isLoaded"
      :container-number="displayTrip?.container?.number"
      :seal-number="displayTrip?.trip.sealNumber"
      :chassis-number="displayTrip?.chassis?.number"
      :container-type="displayTrip?.container?.containerType"
      :origin-name="displayTrip?.origin?.name"
      :destination-name="displayTrip?.destination?.name"
      :customer="displayTrip?.trip.customer"
      :swap-picked="swapSmsReady && loadTrip
        ? {
          tripId: loadTrip.trip.id,
          status: loadTrip.trip.status,
          isLoaded: loadTrip.trip.isLoaded,
          containerNumber: loadTrip.container?.number,
          sealNumber: loadTrip.trip.sealNumber,
          chassisNumber: loadTrip.chassis?.number,
          containerType: loadTrip.container?.containerType,
          originName: loadTrip.origin?.name,
          destinationName: loadTrip.destination?.name,
          customer: loadTrip.trip.customer,
        }
        : null"
      :swap-dropped="swapSmsReady && emptyTrip
        ? {
          tripId: emptyTrip.trip.id,
          status: emptyTrip.trip.status,
          isLoaded: emptyTrip.trip.isLoaded,
          containerNumber: emptyTrip.container?.number,
          sealNumber: emptyTrip.trip.sealNumber,
          chassisNumber: emptyTrip.chassis?.number,
          containerType: emptyTrip.container?.containerType,
          originName: emptyTrip.origin?.name,
          destinationName: emptyTrip.destination?.name,
          customer: emptyTrip.trip.customer,
        }
        : null"
      @close="sheet = null"
    />

    <TripContactsSheet
      :open="sheet === 'contacts'"
      :origin="displayTrip?.origin"
      :destination="displayTrip?.destination"
      @close="sheet = null"
    />

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
