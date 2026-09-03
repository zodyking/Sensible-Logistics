<script setup lang="ts">
import { describeArrival, isSwapEmptyArrival } from '#shared/utils/trip-arrive'

const route = useRoute()
const tripId = computed(() => String(route.params.id))

const { data, error, status } = await useFetch(() => `/api/trips/${tripId.value}`)

useHead({ title: 'Arrive' })

const retainChassis = ref<boolean | null>(null)
const notes = ref('')
const submitting = ref(false)
const errorMessage = ref('')

const destination = computed(() => data.value?.destination ?? null)
const hasChassis = computed(() => Boolean(data.value?.trip.chassisId))

const swapEmpty = computed(() => isSwapEmptyArrival({
  kind: data.value?.trip.kind,
  isLoaded: data.value?.trip.isLoaded,
  swapPairTripId: data.value?.trip.swapPairTripId,
}))

const outcome = computed(() => describeArrival({
  kind: data.value?.trip.kind,
  isLoaded: data.value?.trip.isLoaded,
  swapPairTripId: data.value?.trip.swapPairTripId,
  locationType: destination.value?.type ?? null,
  hasChassis: hasChassis.value,
  retainChassis: retainChassis.value,
}))

const canArrive = computed(() =>
  Boolean(destination.value?.id)
  && !submitting.value
  && (!hasChassis.value || retainChassis.value !== null),
)

async function arrive() {
  if (!canArrive.value || !destination.value?.id) return
  if (hasChassis.value && retainChassis.value === null) return
  submitting.value = true
  errorMessage.value = ''
  try {
    const { withLoader } = useBrandLoader()
    await withLoader(async () => {
      await $fetch(`/api/trips/${tripId.value}/dropoff`, {
        method: 'POST',
        body: {
          eventId: crypto.randomUUID(),
          destinationLocationId: destination.value.id,
          retainChassis: retainChassis.value === true,
          notes: notes.value || null,
        },
      })
      await navigateTo('/')
    })
  }
  catch (err) {
    errorMessage.value = apiErrorMessage(err, 'Could not record the arrival.')
  }
  finally {
    submitting.value = false
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
      Loading trip…
    </div>

    <p
      v-else-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ apiErrorMessage(error, 'Trip not found.') }}</span>
    </p>

    <template v-else-if="data">
      <WizardNav
        :title="swapEmpty ? 'Drop the empty' : 'Arrive'"
        back-to="/"
        back-label="Home"
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
        v-else-if="!destination"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>This trip has no drop-off. Set one from Home, then Arrive.</span>
      </p>

      <TripCard
        :trip-kind="data.trip.kind === 'BARE_CHASSIS' ? 'BARE_CHASSIS' : 'CONTAINER'"
        :container-type="data.container?.containerType"
        :is-loaded="data.trip.isLoaded"
        :container-number="data.container?.number"
        :equipment-type="data.container?.equipmentType"
        :chassis-number="data.chassis?.number"
        :seal-number="data.trip.sealNumber"
        :origin-name="data.origin?.name"
        :destination-name="destination?.name"
        :status="data.trip.status"
      />

      <template v-if="hasChassis">
        <span class="wiz-label">{{ data.trip.kind === 'BARE_CHASSIS' ? 'This chassis' : 'Chassis' }}</span>
        <div class="wiz-group">
          <button
            type="button"
            class="wiz-pick"
            :aria-pressed="retainChassis === true"
            @click="retainChassis = true"
          >
            <span class="wiz-pick-main">
              <b>{{ data.trip.kind === 'BARE_CHASSIS' ? 'Keep with you' : 'Keep attached' }}</b>
              <small>{{ data.trip.kind === 'BARE_CHASSIS' ? 'Stay assigned after this stop' : 'Chassis stays on the box' }}</small>
            </span>
            <span
              v-if="retainChassis === true"
              class="wiz-check"
              aria-hidden="true"
            >✓</span>
            <span
              v-else
              class="wiz-chev"
              aria-hidden="true"
            >›</span>
          </button>
          <button
            type="button"
            class="wiz-pick"
            :aria-pressed="retainChassis === false"
            @click="retainChassis = false"
          >
            <span class="wiz-pick-main">
              <b>{{ data.trip.kind === 'BARE_CHASSIS' ? 'Park here' : 'Unhook' }}</b>
              <small>{{ data.trip.kind === 'BARE_CHASSIS' ? 'Leave the chassis at this location' : 'Chassis stays at this location' }}</small>
            </span>
            <span
              v-if="retainChassis === false"
              class="wiz-check"
              aria-hidden="true"
            >✓</span>
            <span
              v-else
              class="wiz-chev"
              aria-hidden="true"
            >›</span>
          </button>
        </div>
      </template>

      <p class="wiz-hint">
        {{ outcome }}
      </p>

      <span class="wiz-label">Notes</span>
      <div class="wiz-group">
        <div class="wiz-row wiz-row-stack">
          <textarea
            v-model="notes"
            class="textarea"
            placeholder="optional — gate ticket, receiver, damage…"
            aria-label="Notes"
          />
        </div>
      </div>

      <div class="wiz-actions">
        <button
          type="button"
          class="wiz-next"
          :disabled="!canArrive"
          @click="arrive"
        >
          {{ submitting ? 'Saving…' : (swapEmpty ? 'Arrive · finish empty' : 'Arrive') }}
        </button>
      </div>
    </template>
  </section>
</template>
