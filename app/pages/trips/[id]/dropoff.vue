<script setup lang="ts">
import { LOCATION_TYPE_LABELS } from '#shared/utils/domain'
import { describeArrival, isSwapEmptyArrival } from '#shared/utils/trip-arrive'

const route = useRoute()
const tripId = computed(() => String(route.params.id))

const { data, error, status } = await useFetch(() => `/api/trips/${tripId.value}`)

useHead({ title: 'Arrive' })

const destinationLocationId = ref<string | null>(null)
const retainChassis = ref(true)
const notes = ref('')
const locationSearch = ref('')
const pickingLocation = ref(false)
const submitting = ref(false)
const errorMessage = ref('')

watch(data, (value) => {
  if (value?.destination?.id && !destinationLocationId.value) {
    destinationLocationId.value = value.destination.id
  }
}, { immediate: true })

const { data: locationList } = await useFetch('/api/locations', {
  query: computed(() => ({ q: locationSearch.value || undefined, limit: 50 })),
})

const selectedLocation = computed(() => {
  const fromList = locationList.value?.items.find(item => item.id === destinationLocationId.value)
  if (fromList) return fromList
  const dest = data.value?.destination
  if (dest?.id && dest.id === destinationLocationId.value) return dest
  return null
})

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
  locationType: selectedLocation.value && 'type' in selectedLocation.value
    ? selectedLocation.value.type
    : null,
  hasChassis: hasChassis.value,
  retainChassis: retainChassis.value,
}))

const canArrive = computed(() => Boolean(destinationLocationId.value) && !submitting.value)

function chooseLocation(id: string) {
  destinationLocationId.value = id
  pickingLocation.value = false
  locationSearch.value = ''
}

async function arrive() {
  if (!canArrive.value || !destinationLocationId.value) return
  submitting.value = true
  errorMessage.value = ''
  try {
    await $fetch(`/api/trips/${tripId.value}/dropoff`, {
      method: 'POST',
      body: {
        eventId: crypto.randomUUID(),
        destinationLocationId: destinationLocationId.value,
        retainChassis: retainChassis.value,
        notes: notes.value || null,
      },
    })
    await navigateTo('/')
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
        :show-back="false"
      />

      <p
        v-if="errorMessage"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ errorMessage }}</span>
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
        :destination-name="selectedLocation?.name"
        :status="data.trip.status"
      />

      <template v-if="selectedLocation && !pickingLocation">
        <span class="wiz-label">Arriving at</span>
        <div class="wiz-group">
          <button
            type="button"
            class="wiz-pick"
            @click="pickingLocation = true"
          >
            <span class="wiz-pick-main">
              <b>{{ selectedLocation.name }}</b>
              <small>{{ 'type' in selectedLocation ? LOCATION_TYPE_LABELS[selectedLocation.type] : 'Drop-off' }}</small>
            </span>
            <span
              class="wiz-chev"
              aria-hidden="true"
            >›</span>
          </button>
        </div>
      </template>

      <template v-else>
        <div class="searchbar wiz-search">
          <span aria-hidden="true">⌕</span>
          <input
            v-model="locationSearch"
            type="search"
            placeholder="Search yards, customers, terminals…"
            aria-label="Search drop-off locations"
          >
        </div>

        <template v-if="locationList?.items.length">
          <span class="wiz-label">Where are you dropping off?</span>
          <div class="wiz-group">
            <button
              v-for="location in locationList.items"
              :key="location.id"
              type="button"
              class="wiz-pick"
              :aria-pressed="destinationLocationId === location.id"
              @click="chooseLocation(location.id)"
            >
              <span class="wiz-pick-main">
                <b>{{ location.name }}</b>
                <small>
                  {{ LOCATION_TYPE_LABELS[location.type] }}
                  <template v-if="location.addressLine1"> · {{ location.addressLine1 }}</template>
                </small>
              </span>
              <span
                v-if="destinationLocationId === location.id"
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

        <EmptyState
          v-else
          glyph="◫"
          title="No locations match"
          description="Pick an existing location. Add new ones from More → Customers & locations."
        />
      </template>

      <template v-if="hasChassis">
        <span class="wiz-label">Chassis</span>
        <div class="wiz-group">
          <div class="wiz-row wiz-row-toggle">
            <span class="wiz-row-label">
              {{ data.trip.kind === 'BARE_CHASSIS' ? 'Keep this chassis with you?' : 'Keep the chassis attached?' }}
            </span>
            <button
              type="button"
              class="wiz-switch"
              role="switch"
              :aria-checked="retainChassis"
              :aria-label="data.trip.kind === 'BARE_CHASSIS' ? 'Keep this chassis with you' : 'Keep the chassis attached'"
              @click="retainChassis = !retainChassis"
            />
          </div>
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
