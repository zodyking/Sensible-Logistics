<script setup lang="ts">
import { CONTAINER_TYPES, CONTAINER_TYPE_LABELS, EQUIPMENT_TYPES, EQUIPMENT_TYPE_LABELS } from '#shared/utils/domain'
import type { ContainerType, EquipmentType } from '#shared/utils/domain'
import {
  formatContainerNumber,
  normalizeContainerNumber,
  validateContainerNumber,
} from '#shared/utils/iso6346'
import { bboxFromPolygon, normalizeHeading, snapHeadingToStreet } from '#shared/utils/geo'
import type { GeoJsonPolygon } from '#shared/utils/geo'
import { isPlacedPin, locationOrigin, nextOpenSlot, streetHeadingFromMapBearing } from '#shared/utils/yard-slots'
import type { YardMapBox } from '~/components/LocationYardMap.vue'
import { fetchMapBearing } from '~/utils/leaflet-map'

const { user } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')

const route = useRoute()
const locationId = computed(() => String(route.params.id))

const { data: locationData } = await useFetch(() => `/api/locations/${locationId.value}`)

useHead({ title: 'Add container' })

type Step = 'number' | 'containerType' | 'equipmentType' | 'load' | 'place' | 'confirm'
const STEP_TITLES: Record<Step, string> = {
  number: 'Container number',
  containerType: 'Container type',
  equipmentType: 'Equipment size',
  load: 'Loaded or empty?',
  place: 'Place on the map',
  confirm: 'Confirm placement',
}

const rawNumber = ref('')
const containerType = ref<ContainerType>('TROPICAL')
const equipmentType = ref<EquipmentType>('HC_40')
const isLoaded = ref(true)
const pending = ref<YardMapBox | null>(null)
const aligning = ref(false)
const aligningMap = ref(false)
const submitting = ref(false)
const errorMessage = ref('')
const heading = ref(0)
const mapRef = ref<{ recenter: () => void } | null>(null)

watch(() => locationData.value?.location.mapHeading, (value) => {
  if (value != null) heading.value = value
}, { immediate: true })

const normalized = computed(() => normalizeContainerNumber(rawNumber.value))
const validation = computed(() => validateContainerNumber(rawNumber.value))
const showValidation = computed(() => normalized.value.length >= 11)

function resolveNumber(number: string) {
  return $fetch('/api/containers/resolve', { query: { number } })
}
type Resolution = Awaited<ReturnType<typeof resolveNumber>>
const resolution = ref<Resolution | null>(null)
const resolving = ref(false)

const needsClassification = computed(() => resolution.value?.outcome === 'CREATE')

const STEPS = computed<Step[]>(() => {
  const steps: Step[] = ['number']
  if (needsClassification.value) steps.push('containerType', 'equipmentType')
  steps.push('load', 'place', 'confirm')
  return steps
})

const step = ref<Step>('number')
const stepIndex = computed(() => Math.max(0, STEPS.value.indexOf(step.value)))

watch(STEPS, (steps) => {
  if (steps.includes(step.value)) return
  step.value = steps[Math.min(stepIndex.value, steps.length - 1)] ?? 'number'
})

watch(normalized, async (value) => {
  resolution.value = null
  if (value.length < 11) return
  resolving.value = true
  try {
    resolution.value = await resolveNumber(value)
    const found = resolution.value.container
    if (found?.containerType) containerType.value = found.containerType
    if (found?.equipmentType) equipmentType.value = found.equipmentType
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not check the active pool.')
  }
  finally {
    resolving.value = false
  }
})

const blocked = computed(() => {
  if (resolution.value?.outcome === 'CONFLICT') return true
  const state = resolution.value?.container?.activePoolState
  return state === 'PICKUP_IN_PROGRESS' || state === 'DRIVER_CUSTODY'
})

const canAdvance = computed(() => {
  switch (step.value) {
    case 'number':
      return validation.value.structureValid && !blocked.value && !resolving.value && Boolean(resolution.value)
    case 'containerType':
    case 'equipmentType':
    case 'load':
      return true
    case 'place':
      return Boolean(pending.value && isPlacedPin(pending.value.latitude, pending.value.longitude))
    case 'confirm':
      return true
  }
  return false
})

function seedPending() {
  const loc = locationData.value?.location
  const origin = locationOrigin({
    latitude: loc?.latitude,
    longitude: loc?.longitude,
    mapHeading: heading.value,
    boundary: loc?.boundary as GeoJsonPolygon | null,
  })
  const occupied = (locationData.value?.containers ?? []).map(item => ({
    latitude: item.latitude,
    longitude: item.longitude,
  }))
  const slot = origin ? nextOpenSlot(origin, occupied, equipmentType.value) : null
  pending.value = {
    id: 'pending',
    number: formatContainerNumber(normalized.value) || normalized.value,
    containerType: containerType.value,
    equipmentType: equipmentType.value,
    isLoaded: isLoaded.value,
    latitude: slot?.latitude ?? loc?.latitude ?? null,
    longitude: slot?.longitude ?? loc?.longitude ?? null,
    rotation: slot?.rotation ?? streetHeadingFromMapBearing(heading.value),
  }
}

async function next() {
  errorMessage.value = ''
  if (step.value === 'load') seedPending()
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
    const box = bboxFromPolygon(locationData.value?.location.boundary as GeoJsonPolygon | null)
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
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not read the nearby street.')
  }
  finally {
    aligning.value = false
  }
}

const confirmBoxes = computed(() => {
  const existing = locationData.value?.containers ?? []
  return pending.value
    ? [...existing.filter(item => item.id !== pending.value!.id), pending.value]
    : existing
})

watch([containerType, equipmentType, isLoaded, normalized], () => {
  if (!pending.value) return
  pending.value = {
    ...pending.value,
    number: formatContainerNumber(normalized.value) || normalized.value,
    containerType: containerType.value,
    equipmentType: equipmentType.value,
    isLoaded: isLoaded.value,
  }
})

function rotateMap(delta: number) {
  heading.value = normalizeHeading(heading.value + delta)
}

async function alignMapToRoad() {
  const loc = locationData.value?.location
  if (!loc || !isPlacedPin(loc.latitude, loc.longitude)) return
  aligningMap.value = true
  try {
    heading.value = await fetchMapBearing(
      loc.latitude,
      loc.longitude,
      bboxFromPolygon(loc.boundary as GeoJsonPolygon | null),
    )
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not read the nearby street.')
  }
  finally {
    aligningMap.value = false
  }
}

async function confirm() {
  if (!pending.value || !isPlacedPin(pending.value.latitude, pending.value.longitude) || submitting.value) return
  submitting.value = true
  errorMessage.value = ''
  try {
    await $fetch(`/api/locations/${locationId.value}/containers`, {
      method: 'POST',
      body: {
        eventId: crypto.randomUUID(),
        containerNumber: normalized.value,
        containerType: containerType.value,
        equipmentType: equipmentType.value,
        isLoaded: isLoaded.value,
        placement: {
          latitude: pending.value.latitude,
          longitude: pending.value.longitude,
          rotation: pending.value.rotation,
        },
      },
    })
    await navigateTo(`/locations/${locationId.value}`)
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not add the container.')
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <section :class="user?.role === 'ADMIN' ? '' : 'd-page'">
    <PageHeader
      eyebrow="Add container"
      :title="STEP_TITLES[step]"
      :back-to="`/locations/${locationId}`"
      :back-label="locationData?.location.name ?? 'Location'"
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

    <template v-if="step === 'number'">
      <div class="card p-4">
        <label class="field !mb-0">
          <span>Container number</span>
          <ContainerNumberInput
            v-model="rawNumber"
            :invalid="showValidation && !validation.structureValid"
            describedby="add-container-validation"
          />
        </label>
        <div
          id="add-container-validation"
          aria-live="polite"
        >
          <p
            v-if="showValidation && validation.valid"
            class="banner ok mt-3 mb-0"
          >
            <span aria-hidden="true">✓</span>
            <span><b>{{ formatContainerNumber(normalized) }}</b> ISO 6346 check digit is valid.</span>
          </p>
          <p
            v-else-if="showValidation"
            class="banner warn mt-3 mb-0"
          >
            <span aria-hidden="true">!</span>
            <span>{{ validation.errors[0] }}</span>
          </p>
        </div>
      </div>
      <p
        v-if="resolving"
        class="banner info mt-4"
        role="status"
      >
        <span aria-hidden="true">▸</span>
        <span>Checking the active pool…</span>
      </p>
      <p
        v-else-if="resolution"
        class="banner mt-4"
        :class="blocked ? 'err' : 'info'"
        role="status"
      >
        <span aria-hidden="true">▸</span>
        <span>
          {{
            blocked && resolution.outcome !== 'CONFLICT'
              ? 'A driver currently holds this container. Finish or cancel that movement first.'
              : resolution.message
          }}
        </span>
      </p>
    </template>

    <template v-else-if="step === 'containerType'">
      <div class="choice-grid cols-2">
        <button
          v-for="type in CONTAINER_TYPES"
          :key="type"
          type="button"
          class="choice-card"
          :aria-pressed="containerType === type"
          @click="containerType = type"
        >
          {{ CONTAINER_TYPE_LABELS[type] }}
        </button>
      </div>
    </template>

    <template v-else-if="step === 'equipmentType'">
      <div class="choice-grid cols-2">
        <button
          v-for="type in EQUIPMENT_TYPES"
          :key="type"
          type="button"
          class="choice-card"
          :aria-pressed="equipmentType === type"
          @click="equipmentType = type"
        >
          {{ EQUIPMENT_TYPE_LABELS[type] }}
        </button>
      </div>
    </template>

    <template v-else-if="step === 'load'">
      <div class="choice-grid">
        <button
          type="button"
          class="choice-card"
          :aria-pressed="isLoaded"
          @click="isLoaded = true"
        >
          Loaded
          <small>Freight is on the box</small>
        </button>
        <button
          type="button"
          class="choice-card"
          :aria-pressed="!isLoaded"
          @click="isLoaded = false"
        >
          Empty
          <small>Bobtail or empty park</small>
        </button>
      </div>
    </template>

    <template v-else-if="step === 'place'">
      <ClientOnly>
        <LocationYardMap
          ref="mapRef"
          mode="place"
          :boundary="(locationData?.location.boundary as GeoJsonPolygon | null) ?? null"
          :latitude="locationData?.location.latitude"
          :longitude="locationData?.location.longitude"
          :heading="heading"
          :containers="locationData?.containers ?? []"
          :pending="pending"
          @update:pending="onPending"
          @update:heading="heading = $event"
        />
      </ClientOnly>
      <MapRotateBar
        class="mt-3"
        :heading="heading"
        :aligning="aligningMap"
        @rotate="rotateMap"
        @align="alignMapToRoad"
        @recenter="mapRef?.recenter()"
      />
      <ContainerPlaceControls
        v-if="pending"
        class="mt-3"
        :rotation="pending.rotation"
        :aligning="aligning"
        @rotate="rotate"
        @align="alignToStreet"
      />
    </template>

    <template v-else>
      <ClientOnly>
        <LocationYardMap
          mode="view"
          :boundary="(locationData?.location.boundary as GeoJsonPolygon | null) ?? null"
          :latitude="locationData?.location.latitude"
          :longitude="locationData?.location.longitude"
          :heading="heading"
          :containers="confirmBoxes"
          :selected-id="'pending'"
        />
      </ClientOnly>
      <div class="card mt-3 p-4">
        <span class="eyebrow">On the map</span>
        <b class="mt-2 block font-mono text-lg">{{ formatContainerNumber(normalized) }}</b>
        <p class="mt-2 text-sm text-[var(--color-ink-500)]">
          {{ CONTAINER_TYPE_LABELS[containerType] }}
          · {{ EQUIPMENT_TYPE_LABELS[equipmentType] }}
          · {{ isLoaded ? 'Loaded' : 'Empty' }}
        </p>
        <p class="mt-2 text-sm">
          {{ locationData?.location.name }}
        </p>
      </div>
      <button
        type="button"
        class="btn-primary-action mt-4"
        :disabled="submitting"
        @click="confirm"
      >
        {{ submitting ? 'Saving…' : 'Save container' }}
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
  </section>
</template>
