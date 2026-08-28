<script setup lang="ts">
import { LOCATION_TYPE_LABELS } from '#shared/utils/domain'
import { describeDropoffEffect } from '#shared/utils/service-life'
import { bboxCenter, bboxFromPolygon, normalizeHeading, snapHeadingToStreet } from '#shared/utils/geo'
import type { GeoJsonPolygon } from '#shared/utils/geo'
import type { YardMapBox } from '~/components/LocationYardMap.vue'

const route = useRoute()
const tripId = computed(() => String(route.params.id))

const { data, error, status } = await useFetch(() => `/api/trips/${tripId.value}`)

useHead({ title: 'Drop off' })

type Step = 'location' | 'place' | 'options' | 'confirm'
const STEP_TITLES: Record<Step, string> = {
  location: 'Where are you dropping off?',
  place: 'Place the container',
  options: 'Drop-off details',
  confirm: 'Confirm drop-off',
}

const destinationLocationId = ref<string | null>(null)
const retainChassis = ref(false)
const notes = ref('')
const locationSearch = ref('')
const pending = ref<YardMapBox | null>(null)
const aligning = ref(false)
const submitting = ref(false)
const errorMessage = ref('')
const step = ref<Step>('location')

watch(data, (value) => {
  if (value?.destination?.id && !destinationLocationId.value) {
    destinationLocationId.value = value.destination.id
  }
}, { immediate: true })

const { data: locationList } = await useFetch('/api/locations', {
  query: computed(() => ({ q: locationSearch.value || undefined, limit: 50 })),
})

const { data: destination, refresh: refreshDestination } = await useAsyncData(
  'dropoff-location',
  () => destinationLocationId.value
    ? $fetch(`/api/locations/${destinationLocationId.value}`)
    : Promise.resolve(null),
  { watch: [destinationLocationId] },
)

const hasContainer = computed(() => Boolean(data.value?.container))

const STEPS = computed<Step[]>(() => {
  const steps: Step[] = ['location']
  if (hasContainer.value) steps.push('place')
  steps.push('options', 'confirm')
  return steps
})

const stepIndex = computed(() => Math.max(0, STEPS.value.indexOf(step.value)))

const selectedLocation = computed(() =>
  locationList.value?.items.find(item => item.id === destinationLocationId.value)
  ?? destination.value?.location
  ?? null,
)

const dropoffHint = computed(() =>
  selectedLocation.value ? describeDropoffEffect(selectedLocation.value.type) : null,
)

function seedPending() {
  const loc = destination.value?.location
  const box = bboxFromPolygon(loc?.boundary as GeoJsonPolygon | null)
  const center = box
    ? bboxCenter(box)
    : { latitude: loc?.latitude ?? 0, longitude: loc?.longitude ?? 0 }
  const container = data.value?.container
  pending.value = {
    id: container?.id ?? 'pending',
    number: container?.number ?? 'Container',
    containerType: container?.containerType ?? 'CMA',
    equipmentType: container?.equipmentType ?? 'DRY_40',
    isLoaded: Boolean(data.value?.trip.isLoaded),
    latitude: center.latitude,
    longitude: center.longitude,
    rotation: 0,
  }
}

const canAdvance = computed(() => {
  switch (step.value) {
    case 'location':
      return Boolean(destinationLocationId.value)
    case 'place':
      return Boolean(pending.value?.latitude != null && pending.value?.longitude != null)
    case 'options':
    case 'confirm':
      return true
  }
  return false
})

async function next() {
  errorMessage.value = ''
  if (step.value === 'location') {
    await refreshDestination()
    if (hasContainer.value) seedPending()
  }
  const index = stepIndex.value
  if (index < STEPS.value.length - 1) step.value = STEPS.value[index + 1]!
}

function back() {
  const index = stepIndex.value
  if (index > 0) step.value = STEPS.value[index - 1]!
}

function onPending(nextPos: { latitude: number, longitude: number, rotation: number }) {
  if (!pending.value) return
  pending.value = { ...pending.value, ...nextPos }
}

function rotate(delta: number) {
  if (!pending.value) return
  pending.value = { ...pending.value, rotation: normalizeHeading(pending.value.rotation + delta) }
}

async function alignToStreet() {
  if (!pending.value || pending.value.latitude == null || pending.value.longitude == null) return
  aligning.value = true
  try {
    const box = bboxFromPolygon(destination.value?.location.boundary as GeoJsonPolygon | null)
    const result = await $fetch('/api/geocode/heading', {
      query: {
        lat: pending.value.latitude,
        lng: pending.value.longitude,
        west: box?.west,
        south: box?.south,
        east: box?.east,
        north: box?.north,
      },
    })
    pending.value = {
      ...pending.value,
      rotation: snapHeadingToStreet(pending.value.rotation, result.heading),
    }
  }
  catch (err) {
    errorMessage.value = apiErrorMessage(err, 'Could not read the nearby street.')
  }
  finally {
    aligning.value = false
  }
}

async function confirm() {
  if (!destinationLocationId.value || submitting.value) return
  submitting.value = true
  errorMessage.value = ''
  try {
    await $fetch(`/api/trips/${tripId.value}/dropoff`, {
      method: 'POST',
      body: {
        eventId: crypto.randomUUID(),
        destinationLocationId: destinationLocationId.value,
        placement: hasContainer.value && pending.value?.latitude != null && pending.value.longitude != null
          ? {
              latitude: pending.value.latitude,
              longitude: pending.value.longitude,
              rotation: pending.value.rotation,
            }
          : null,
        retainChassis: retainChassis.value,
        notes: notes.value || null,
      },
    })
    await navigateTo(`/locations/${destinationLocationId.value}`)
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
        eyebrow="Drop off"
        :title="STEP_TITLES[step]"
        :back-to="`/trips/${tripId}`"
        back-label="Trip"
      />

      <div
        class="stepper"
        role="progressbar"
        :aria-valuenow="stepIndex + 1"
        aria-valuemin="1"
        :aria-valuemax="STEPS.length"
        :aria-label="`Step ${stepIndex + 1} of ${STEPS.length}`"
      >
        <span
          v-for="(name, index) in STEPS"
          :key="name"
          class="stepper-step"
          :class="{ done: index < stepIndex, on: index === stepIndex }"
        />
      </div>

      <p
        v-if="errorMessage"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ errorMessage }}</span>
      </p>

      <template v-if="step === 'location'">
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
            @click="destinationLocationId = location.id"
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
          description="Pick an existing location. Add new ones from More → Location/Customer Manager."
        />
      </template>

      <template v-else-if="step === 'place'">
        <ClientOnly>
          <LocationYardMap
            mode="place"
            :boundary="(destination?.location.boundary as GeoJsonPolygon | null) ?? null"
            :latitude="destination?.location.latitude"
            :longitude="destination?.location.longitude"
            :containers="destination?.containers ?? []"
            :pending="pending"
            @update:pending="onPending"
          />
        </ClientOnly>
        <ContainerPlaceControls
          v-if="pending"
          class="mt-3"
          :rotation="pending.rotation"
          :aligning="aligning"
          @rotate="rotate"
          @align="alignToStreet"
        />
      </template>

      <template v-else-if="step === 'options'">
        <label class="flex min-h-11 items-center gap-3 text-sm font-semibold">
          <input
            v-model="retainChassis"
            type="checkbox"
            class="size-5"
            :disabled="!data.trip.chassisId"
          >
          Keep the chassis attached
        </label>
        <p
          v-if="dropoffHint"
          class="mt-3 text-sm text-[var(--color-ink-500)]"
        >
          {{ dropoffHint }}
        </p>
        <label class="field mt-4 !mb-0">
          <span>Notes</span>
          <textarea
            v-model="notes"
            class="textarea"
            placeholder="Receiving contact, gate ticket number, exceptions…"
          />
        </label>
      </template>

      <template v-else>
        <TripCard
          :trip-kind="data.trip.kind === 'BARE_CHASSIS' ? 'BARE_CHASSIS' : 'CONTAINER'"
          :container-type="data.container?.containerType"
          :is-loaded="data.trip.isLoaded"
          :container-number="data.container?.number"
          :equipment-type="data.container?.equipmentType"
          :chassis-number="data.chassis?.number"
          :seal-number="data.trip.sealNumber"
          :origin-name="data.origin?.name"
          :destination-name="selectedLocation && 'name' in selectedLocation ? selectedLocation.name : undefined"
        />
        <p class="banner info">
          <span aria-hidden="true">▸</span>
          <span>
            {{
              dropoffHint
                || (hasContainer
                  ? 'Confirming parks this container on the map and closes the movement.'
                  : 'Confirming closes the chassis movement at this location.')
            }}
          </span>
        </p>
        <button
          type="button"
          class="btn-primary-action"
          :disabled="submitting"
          @click="confirm"
        >
          {{ submitting ? 'Saving…' : 'Complete drop-off' }}
        </button>
      </template>

      <div class="mt-6 flex gap-3">
        <button
          v-if="stepIndex > 0"
          type="button"
          class="btn-ghost flex-1"
          @click="back"
        >
          Back
        </button>
        <button
          v-if="step !== 'confirm'"
          type="button"
          class="btn-dark flex-1"
          :disabled="!canAdvance || submitting"
          @click="next"
        >
          Continue
        </button>
      </div>
    </template>
  </section>
</template>
