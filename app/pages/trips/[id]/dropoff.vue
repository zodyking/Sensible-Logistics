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
      <PageHeader
        eyebrow="Arrive"
        :title="swapEmpty ? 'Drop the empty' : 'Drop off here'"
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

      <div class="arrive-block">
        <span class="field-label">Where</span>

        <template v-if="selectedLocation && !pickingLocation">
          <div class="card arrive-where">
            <div>
              <b>{{ selectedLocation.name }}</b>
              <small>{{ 'type' in selectedLocation ? LOCATION_TYPE_LABELS[selectedLocation.type] : 'Drop-off' }}</small>
            </div>
            <button
              type="button"
              class="route-change"
              @click="pickingLocation = true"
            >
              Change
            </button>
          </div>
        </template>

        <template v-else>
          <p
            v-if="!selectedLocation"
            class="note"
          >
            <span>Pick where this is coming off. Pickup already asked for this — it is missing on the trip.</span>
          </p>
          <div class="searchbar">
            <span aria-hidden="true">⌕</span>
            <input
              v-model="locationSearch"
              type="search"
              placeholder="Search yards, customers, terminals…"
              aria-label="Search drop-off locations"
            >
          </div>
          <div
            v-if="locationList?.items.length"
            class="card rowlist"
          >
            <button
              v-for="location in locationList.items"
              :key="location.id"
              type="button"
              class="row"
              :aria-pressed="destinationLocationId === location.id"
              @click="chooseLocation(location.id)"
            >
              <span class="row-main">
                <b>{{ location.name }}</b>
                <small>
                  {{ LOCATION_TYPE_LABELS[location.type] }}
                  <template v-if="location.addressLine1"> · {{ location.addressLine1 }}</template>
                </small>
              </span>
              <span class="row-end">
                <StatusChip
                  v-if="destinationLocationId === location.id"
                  variant="ok"
                  label="Selected"
                />
                <span
                  v-else
                  aria-hidden="true"
                >›</span>
              </span>
            </button>
          </div>
          <EmptyState
            v-else
            glyph="◫"
            title="No locations match"
            description="Pick an existing location. Add new ones from More → Customers & locations."
          />
          <button
            v-if="selectedLocation"
            type="button"
            class="btn-ghost mt-3 w-full"
            @click="pickingLocation = false"
          >
            Keep {{ selectedLocation.name }}
          </button>
        </template>
      </div>

      <div
        v-if="hasChassis"
        class="arrive-block"
      >
        <span class="field-label">Chassis</span>
        <div class="choice-grid cols-2">
          <button
            type="button"
            class="choice-card"
            :aria-pressed="!retainChassis"
            @click="retainChassis = false"
          >
            {{ data.trip.kind === 'BARE_CHASSIS' ? 'Park here' : 'Unhook' }}
            <small>{{ data.trip.kind === 'BARE_CHASSIS' ? 'Available at this stop' : 'Leave it here' }}</small>
          </button>
          <button
            type="button"
            class="choice-card"
            :aria-pressed="retainChassis"
            @click="retainChassis = true"
          >
            {{ data.trip.kind === 'BARE_CHASSIS' ? 'Keep it' : 'Keep attached' }}
            <small>{{ data.trip.kind === 'BARE_CHASSIS' ? 'Stays on this trip' : 'Stays on the box' }}</small>
          </button>
        </div>
      </div>

      <p class="banner info arrive-outcome">
        <span aria-hidden="true">▸</span>
        <span>{{ outcome }}</span>
      </p>

      <label class="field arrive-block">
        <span>Notes</span>
        <textarea
          v-model="notes"
          class="textarea"
          placeholder="Optional — gate ticket, receiver, damage…"
        />
      </label>

      <button
        type="button"
        class="btn-primary-action"
        :disabled="!canArrive"
        @click="arrive"
      >
        {{ submitting ? 'Saving…' : (swapEmpty ? 'Arrive · finish empty' : 'Arrive') }}
      </button>
    </template>
  </section>
</template>
