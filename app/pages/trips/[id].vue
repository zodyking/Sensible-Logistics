<script setup lang="ts">
import { LOCATION_TYPE_LABELS, TRIP_STATUS_CHIP, TRIP_STATUS_LABELS } from '#shared/utils/domain'
import { formatChassisNumber, formatContainerNumber } from '#shared/utils/iso6346'

const route = useRoute()
const tripId = computed(() => String(route.params.id))

const { data, status, error, refresh } = await useFetch(() => `/api/trips/${tripId.value}`)

useHead({ title: () => data.value?.trip.reference ?? 'Trip' })

const showDropoff = ref(false)
const destinationLocationId = ref<string | null>(null)
const retainChassis = ref(false)
const isFinalRelease = ref(false)
const placeInYard = ref(false)
const notes = ref('')
const submitting = ref(false)
const errorMessage = ref('')
const locationSearch = ref('')

const { data: locationData } = await useFetch('/api/locations', {
  query: computed(() => ({ q: locationSearch.value || undefined, limit: 50 })),
})

watch(data, (value) => {
  if (value?.destination?.id && !destinationLocationId.value) {
    destinationLocationId.value = value.destination.id
  }
}, { immediate: true })

const isLive = computed(() =>
  ['PICKUP_IN_PROGRESS', 'IN_TRANSIT', 'DROPOFF_IN_PROGRESS'].includes(data.value?.trip.status ?? ''))

const equipmentLabel = computed(() => {
  const container = data.value?.container?.number
  if (container) return formatContainerNumber(container) || container
  const chassis = data.value?.chassis?.number
  if (chassis) return formatChassisNumber(chassis) || chassis
  return data.value?.trip.reference ?? 'Trip'
})

const pickupStamp = computed(() => data.value?.trip.pickedUpAt ?? null)
const dropoffStamp = computed(() => data.value?.trip.droppedOffAt ?? data.value?.trip.completedAt ?? null)

const durationLabel = computed(() => formatDurationBetween(pickupStamp.value, dropoffStamp.value))

const dropoffTimeLabel = computed(() => {
  if (dropoffStamp.value) return formatDateTime(dropoffStamp.value)
  if (data.value?.trip.status === 'CANCELLED') return 'Cancelled'
  return 'Open'
})

async function completeDropoff() {
  if (!destinationLocationId.value || submitting.value) return
  submitting.value = true
  errorMessage.value = ''

  try {
    await $fetch(`/api/trips/${tripId.value}/dropoff`, {
      method: 'POST',
      body: {
        eventId: crypto.randomUUID(),
        destinationLocationId: destinationLocationId.value,
        placement: placeInYard.value ? { x: 0, y: 0, rotation: 0 } : null,
        retainChassis: retainChassis.value,
        isFinalRelease: isFinalRelease.value,
        notes: notes.value || null,
      },
    })

    showDropoff.value = false
    await refresh()
  }
  catch (err) {
    errorMessage.value = apiErrorMessage(err, 'Could not complete the drop-off.')
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
        eyebrow="Trip"
        :title="data.trip.reference"
        back-to="/pickups"
        back-label="Trips"
      />

      <div class="mb-4 flex flex-wrap items-center gap-2">
        <StatusChip
          :variant="TRIP_STATUS_CHIP[data.trip.status]"
          :label="TRIP_STATUS_LABELS[data.trip.status]"
        />
        <span
          v-if="durationLabel"
          class="trip-duration"
        >{{ durationLabel }}</span>
      </div>

      <div class="trip-run card">
        <div class="trip-run-route">
          <div class="trip-hist-point">
            <small>Origin</small>
            <strong>{{ data.origin?.name ?? 'Not set' }}</strong>
            <span
              v-if="data.origin?.city"
              class="trip-run-city"
            >{{ data.origin.city }}</span>
          </div>
          <span
            class="trip-hist-arrow"
            aria-hidden="true"
          >→</span>
          <div class="trip-hist-point dest">
            <small>Drop-off</small>
            <strong>{{ data.destination?.name ?? 'Choose at drop-off' }}</strong>
            <span
              v-if="data.destination?.city"
              class="trip-run-city"
            >{{ data.destination.city }}</span>
            <button
              v-if="isLive || !data.destination"
              type="button"
              class="route-change"
              @click="showDropoff = true"
            >
              Change
            </button>
          </div>
        </div>

        <ol class="trip-run-log">
          <li>
            <span
              class="trip-run-dot pickup"
              aria-hidden="true"
            />
            <div>
              <small>Picked up</small>
              <b>{{ pickupStamp ? formatDateTime(pickupStamp) : 'Not yet picked up' }}</b>
              <p>{{ data.origin?.name ?? 'Origin not set' }}</p>
            </div>
          </li>
          <li>
            <span
              class="trip-run-dot"
              :class="dropoffStamp ? 'dropoff' : 'pending'"
              aria-hidden="true"
            />
            <div>
              <small>Dropped off</small>
              <b>{{ dropoffTimeLabel }}</b>
              <p>{{ data.destination?.name ?? 'Destination open' }}</p>
            </div>
          </li>
        </ol>
      </div>

      <NuxtLink
        v-if="data.container"
        :to="`/containers/${data.container.id}`"
        class="equip-link"
      >
        <span>
          <small>Equipment</small>
          <b class="mono">{{ equipmentLabel }}</b>
        </span>
        <span class="equip-link-go">View record →</span>
      </NuxtLink>

      <div class="home-actions">
        <NuxtLink
          v-if="data.container"
          :to="`/containers/${data.container.id}`"
        >
          <span
            class="act-ico"
            aria-hidden="true"
          >▤</span>
          Documents
        </NuxtLink>
        <button type="button">
          <span
            class="act-ico"
            aria-hidden="true"
          >✉</span>
          Send SMS
        </button>
        <button type="button">
          <span
            class="act-ico"
            aria-hidden="true"
          >☎</span>
          Contacts
        </button>
        <NuxtLink
          v-if="data.container"
          :to="`/containers/${data.container.id}`"
        >
          <span
            class="act-ico"
            aria-hidden="true"
          >☰</span>
          Equipment
        </NuxtLink>
      </div>

      <NuxtLink
        v-if="isLive && data.chassis && !data.container && data.trip.status !== 'PICKUP_IN_PROGRESS'"
        to="/pickups/attach"
        class="btn-dark home-cta mb-3"
      >
        Add container to chassis
      </NuxtLink>

      <button
        v-if="isLive"
        class="btn-primary-action home-cta mb-4"
        @click="showDropoff = true"
      >
        Arrive
      </button>
    </template>

    <BottomSheet
      :open="showDropoff"
      title="Change drop-off location"
      @close="showDropoff = false"
    >
      <p
        v-if="errorMessage"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ errorMessage }}</span>
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
        v-for="location in locationData?.items ?? []"
        :key="location.id"
        type="button"
        class="sheet-loc"
        :class="{ sel: destinationLocationId === location.id }"
        @click="destinationLocationId = location.id"
      >
        <b>{{ location.name }}</b>
        <small>
          {{ LOCATION_TYPE_LABELS[location.type] }}
          <template v-if="location.addressLine1"> · {{ location.addressLine1 }}</template>
        </small>
      </button>

      <label
        v-if="data?.container"
        class="flex min-h-11 items-center gap-3 text-sm font-semibold"
      >
        <input
          v-model="placeInYard"
          type="checkbox"
          class="size-5"
        >
        Record an exact yard position
      </label>
      <label class="flex min-h-11 items-center gap-3 text-sm font-semibold">
        <input
          v-model="retainChassis"
          type="checkbox"
          class="size-5"
          :disabled="!data?.trip.chassisId"
        >
        Keep the chassis attached
      </label>
      <label
        v-if="data?.container"
        class="flex min-h-11 items-center gap-3 text-sm font-semibold"
      >
        <input
          v-model="isFinalRelease"
          type="checkbox"
          class="size-5"
        >
        Final release from the tracked network
      </label>

      <label class="field !mb-0">
        <span>Notes</span>
        <textarea
          v-model="notes"
          class="textarea"
          placeholder="Receiving contact, gate ticket number, exceptions…"
        />
      </label>

      <div class="sheet-actions">
        <button
          type="button"
          class="btn-cancel"
          @click="showDropoff = false"
        >
          Cancel
        </button>
        <button
          type="button"
          class="btn-save"
          :disabled="!destinationLocationId || submitting"
          @click="completeDropoff"
        >
          {{ submitting ? 'Saving…' : 'Complete drop-off' }}
        </button>
      </div>
    </BottomSheet>
  </section>
</template>
