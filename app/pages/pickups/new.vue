<script setup lang="ts">
import { ACTIVE_POOL_LABELS, CONTAINER_TYPES, CONTAINER_TYPE_LABELS, EQUIPMENT_TYPES, EQUIPMENT_TYPE_LABELS, LOCATION_GLYPH, TRIP_KIND_LABELS } from '#shared/utils/domain'
import type { ContainerType, EquipmentType, TripKind } from '#shared/utils/domain'
import {
  formatChassisNumber,
  formatContainerNumber,
  isCompleteChassisNumber,
  maskChassisInput,
  maskContainerInput,
  normalizeContainerNumber,
  validateContainerNumber,
} from '#shared/utils/iso6346'
import { driverOcrMessage } from '#shared/utils/ocr-parse'

useHead({ title: 'New pickup' })

type Step = 'kind' | 'location' | 'equipment' | 'containerType' | 'equipmentType' | 'load' | 'seal' | 'notes' | 'confirm'

const STEP_TITLES: Record<Step, string> = {
  kind: 'What are you picking up?',
  location: 'Where are you picking up?',
  equipment: 'Container and chassis',
  containerType: 'Container type',
  equipmentType: 'Equipment size',
  load: 'Loaded or empty?',
  seal: 'Seal number',
  notes: 'Notes',
  confirm: 'Confirm pickup',
}

const originLocationId = ref<string | null>(null)
const pickupKind = ref<TripKind>('CONTAINER')
const rawNumber = ref('')
const containerType = ref<ContainerType>('TROPICAL')
const equipmentType = ref<EquipmentType>('HC_40')
const chassisId = ref<string | null>(null)
const chassisNumber = ref('')
const isLoaded = ref(true)
const sealNumber = ref('')
const notes = ref('')

function resolveNumber(number: string) {
  return $fetch('/api/containers/resolve', { query: { number } })
}

type Resolution = Awaited<ReturnType<typeof resolveNumber>>
const resolution = ref<Resolution | null>(null)

const needsClassification = computed(() => resolution.value?.outcome === 'CREATE')

const STEPS = computed<Step[]>(() => {
  const steps: Step[] = ['kind', 'location', 'equipment']
  if (pickupKind.value === 'CONTAINER' && needsClassification.value) {
    steps.push('containerType', 'equipmentType')
  }
  if (pickupKind.value === 'CONTAINER') {
    steps.push('load')
    if (isLoaded.value) steps.push('seal')
  }
  steps.push('notes', 'confirm')
  return steps
})

const step = ref<Step>('kind')
const stepIndex = computed(() => Math.max(0, STEPS.value.indexOf(step.value)))

watch(STEPS, (steps) => {
  if (steps.includes(step.value)) return
  const order: Step[] = ['kind', 'location', 'equipment', 'containerType', 'equipmentType', 'load', 'seal', 'notes', 'confirm']
  const from = order.indexOf(step.value)
  const following = order.slice(from + 1).find(name => steps.includes(name))
  const previous = [...order.slice(0, Math.max(0, from))].reverse().find(name => steps.includes(name))
  step.value = following ?? previous ?? 'kind'
})

/* --- Data sources ----------------------------------------------- */
const locationSearch = ref('')
const { data: locationData } = await useFetch('/api/locations', {
  query: computed(() => ({ q: locationSearch.value || undefined, limit: 50 })),
})

watch(pickupKind, (kind) => {
  STEP_TITLES.equipment = kind === 'BARE_CHASSIS' ? 'Chassis' : 'Container and chassis'
})

const route = useRoute()
rawNumber.value = maskContainerInput(String(route.query.number ?? ''))
if (route.query.chassis) chassisNumber.value = maskChassisInput(String(route.query.chassis))

const submitting = ref(false)
const errorMessage = ref('')
const cameraOpen = ref(false)
const capturedPhoto = ref('')
const readingPhoto = ref(false)
const ocrMessage = ref('')
const cameraAutoOpened = ref(false)

/* --- ISO 6346 validation (mirrors the server implementation) ----- */
const normalized = computed(() => normalizeContainerNumber(rawNumber.value))
const validation = computed(() => validateContainerNumber(rawNumber.value))
const showValidation = computed(() => normalized.value.length >= 11)

/* --- Active-pool resolution -------------------------------------- */
const resolving = ref(false)

async function checkPool() {
  if (normalized.value.length < 11) return
  resolving.value = true
  errorMessage.value = ''
  try {
    resolution.value = await resolveNumber(normalized.value)
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
}

watch(normalized, (value) => {
  resolution.value = null
  if (value.length === 11) checkPool()
}, { immediate: true })

const RESOLUTION_COPY: Record<string, { variant: 'ok' | 'warn' | 'err' | 'info', title: string }> = {
  REUSE_ACTIVE: { variant: 'info', title: 'Already in the active pool' },
  REACTIVATE: { variant: 'warn', title: 'Known container — will be reactivated' },
  CREATE: { variant: 'ok', title: 'New container record' },
  CONFLICT: { variant: 'err', title: 'Another driver holds this container' },
}

const blockedByConflict = computed(() => resolution.value?.outcome === 'CONFLICT')

/* --- Field status: a mark on the field, wording only when asked --- */
type FieldState = 'ok' | 'error' | 'idle'

const containerState = computed<FieldState>(() => {
  if (!showValidation.value) return 'idle'
  return validation.value.valid ? 'ok' : 'error'
})

const containerDetail = computed(() => {
  if (!showValidation.value) return ''
  const parts: string[] = []
  if (!validation.value.valid) {
    parts.push(validation.value.errors[0] ?? 'This is not a valid ISO 6346 number.')
    if (validation.value.structureValid && validation.value.expectedCheckDigit !== null) {
      parts.push(`The boxed digit should be ${validation.value.expectedCheckDigit}.`)
    }
  }
  parts.push(...validation.value.warnings)
  return parts.join(' ')
})

const chassisState = computed<FieldState>(() => {
  if (!chassisNumber.value) return 'idle'
  return isCompleteChassisNumber(chassisNumber.value) ? 'ok' : 'error'
})

const chassisDetail = computed(() =>
  chassisState.value === 'error' ? 'A chassis number is four letters then six digits.' : '',
)

/* --- The movement, created once the identifier is confirmed ------ */
const tripId = ref<string | null>(null)
const existingTripId = ref<string | null>(null)
const hydrating = ref(false)

async function hydrateFromTrip(id: string) {
  hydrating.value = true
  errorMessage.value = ''
  try {
    const data = await $fetch(`/api/trips/${id}`)
    if (data.trip.status !== 'PICKUP_IN_PROGRESS') {
      errorMessage.value = 'That pickup is no longer in progress.'
      return
    }
    tripId.value = data.trip.id
    originLocationId.value = data.trip.originLocationId
    pickupKind.value = data.trip.kind === 'BARE_CHASSIS' ? 'BARE_CHASSIS' : 'CONTAINER'
    rawNumber.value = maskContainerInput(data.container?.numberNormalized ?? data.container?.number ?? '')
    if (data.container?.containerType) containerType.value = data.container.containerType
    if (data.container?.equipmentType) equipmentType.value = data.container.equipmentType
    chassisId.value = data.trip.chassisId
    chassisNumber.value = maskChassisInput(data.chassis?.number ?? '')
    isLoaded.value = Boolean(data.trip.isLoaded)
    sealNumber.value = data.trip.sealNumber ?? ''
    notes.value = data.trip.driverNotes ?? ''
    step.value = 'equipment'
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not resume that pickup.')
  }
  finally {
    hydrating.value = false
  }
}

onMounted(async () => {
  const fromQuery = String(route.query.trip ?? '')
  if (fromQuery) {
    await hydrateFromTrip(fromQuery)
    return
  }
  try {
    const live = await $fetch('/api/trips', { query: { scope: 'mine', status: 'PICKUP_IN_PROGRESS', limit: 1 } })
    if (live.items[0]) existingTripId.value = live.items[0].id
  }
  catch {
    // Listing live trips is a convenience, not a blocker.
  }
})

const claimStep = computed<Step>(() => {
  if (pickupKind.value === 'BARE_CHASSIS') return 'equipment'
  return needsClassification.value ? 'equipmentType' : 'equipment'
})

const chassisOk = computed(() => {
  if (pickupKind.value === 'BARE_CHASSIS') return isCompleteChassisNumber(chassisNumber.value)
  return !chassisNumber.value || isCompleteChassisNumber(chassisNumber.value)
})

const originLocation = computed(() =>
  locationData.value?.items.find(item => item.id === originLocationId.value) ?? null,
)

const canAdvance = computed(() => {
  switch (step.value) {
    case 'kind':
      return pickupKind.value === 'CONTAINER' || pickupKind.value === 'BARE_CHASSIS'
    case 'location':
      return Boolean(originLocationId.value)
    case 'equipment':
      if (pickupKind.value === 'BARE_CHASSIS') {
        return chassisOk.value && !readingPhoto.value && !cameraOpen.value
      }
      return validation.value.structureValid
        && chassisOk.value
        && !blockedByConflict.value
        && !resolving.value
        && Boolean(resolution.value)
        && !readingPhoto.value
        && !cameraOpen.value
    case 'containerType':
    case 'equipmentType':
    case 'load':
    case 'seal':
    case 'notes':
    case 'confirm':
      return true
  }
  return false
})

async function attachChassis() {
  const typed = chassisNumber.value.trim()
  if (!typed) {
    chassisId.value = null
    return
  }
  const result = await $fetch('/api/chassis', {
    method: 'POST',
    body: { number: typed },
  })
  chassisId.value = result.item.id
  chassisNumber.value = result.item.number
}

async function next() {
  errorMessage.value = ''

  if (step.value === 'equipment') {
    try {
      await attachChassis()
    }
    catch (error) {
      errorMessage.value = apiErrorMessage(error, 'Could not save the chassis.')
      return
    }
  }

  if (step.value === claimStep.value && !tripId.value) {
    await startPickup()
    if (errorMessage.value) return
  }

  const index = stepIndex.value
  if (index < STEPS.value.length - 1) step.value = STEPS.value[index + 1]!
}

function back() {
  const index = stepIndex.value
  if (index > 0) step.value = STEPS.value[index - 1]!
}

async function startPickup() {
  if (pickupKind.value === 'BARE_CHASSIS' && !chassisId.value) {
    errorMessage.value = 'Enter a chassis number.'
    return
  }
  submitting.value = true
  try {
    const body: Record<string, unknown> = {
      eventId: crypto.randomUUID(),
      kind: pickupKind.value,
      originLocationId: originLocationId.value,
    }
    if (pickupKind.value === 'BARE_CHASSIS') {
      body.chassisId = chassisId.value
    }
    else {
      body.containerNumber = normalized.value
      body.containerType = containerType.value
      body.equipmentType = equipmentType.value
    }

    const result = await $fetch('/api/pickups/start', {
      method: 'POST',
      body,
    })
    tripId.value = result.trip.id
  }
  catch (error) {
    const payload = error as { statusCode?: number, data?: { tripId?: string, data?: { tripId?: string } } }
    const resumeId = payload.data?.tripId ?? payload.data?.data?.tripId
    if (payload.statusCode === 409 && resumeId) {
      existingTripId.value = resumeId
      try {
        const data = await $fetch(`/api/trips/${resumeId}`)
        if (data.trip.status === 'PICKUP_IN_PROGRESS') {
          errorMessage.value = apiErrorMessage(error, 'You already have a pickup in progress.')
          await hydrateFromTrip(resumeId)
          return
        }
        await navigateTo(`/trips/${resumeId}`)
        return
      }
      catch {
        errorMessage.value = apiErrorMessage(error, 'You already have an active movement.')
        return
      }
    }
    errorMessage.value = apiErrorMessage(error, 'Could not start the pickup.')
  }
  finally {
    submitting.value = false
  }
}

async function confirm() {
  if (!tripId.value || submitting.value) return
  submitting.value = true
  errorMessage.value = ''

  try {
    await $fetch(`/api/trips/${tripId.value}/confirm`, {
      method: 'POST',
      body: {
        eventId: crypto.randomUUID(),
        chassisId: chassisId.value,
        isLoaded: pickupKind.value === 'CONTAINER' ? isLoaded.value : false,
        sealNumber: pickupKind.value === 'CONTAINER' ? (sealNumber.value || null) : null,
        notes: notes.value || null,
      },
    })
    await navigateTo(`/trips/${tripId.value}`)
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not confirm the pickup.')
  }
  finally {
    submitting.value = false
  }
}

async function abandon() {
  if (!tripId.value) {
    await navigateTo('/')
    return
  }

  try {
    await $fetch(`/api/trips/${tripId.value}/cancel`, {
      method: 'POST',
      body: { eventId: crypto.randomUUID(), reason: 'Driver cancelled before confirming.' },
    })
  }
  finally {
    await navigateTo('/')
  }
}

watch(step, (current) => {
  if (current !== 'equipment') return
  if (cameraAutoOpened.value || tripId.value || rawNumber.value || cameraOpen.value) return
  cameraAutoOpened.value = true
  cameraOpen.value = true
})

async function onPhoto(dataUrl: string) {
  capturedPhoto.value = dataUrl
  readingPhoto.value = true
  ocrMessage.value = ''
  errorMessage.value = ''
  try {
    const result = await $fetch('/api/scan/recognize', {
      method: 'POST',
      timeout: 180_000,
      headers: { 'Cache-Control': 'no-store' },
      body: { image: dataUrl },
    })
    if (result.container && pickupKind.value === 'CONTAINER') {
      rawNumber.value = maskContainerInput(result.container)
    }
    if (result.chassis) chassisNumber.value = maskChassisInput(result.chassis)
    if (pickupKind.value === 'BARE_CHASSIS') {
      if (!result.chassis) {
        ocrMessage.value = result.message || 'No chassis number could be read. Edit the field or retake.'
      }
    }
    else if (!result.container) {
      ocrMessage.value = result.message || 'No container number could be read. Edit the fields or retake.'
    }
  }
  catch (error) {
    ocrMessage.value = driverOcrMessage(
      apiErrorMessage(error, 'Could not read the photo. Edit the fields or retake.'),
      'Could not read the photo. Edit the fields or retake.',
    )
  }
  finally {
    readingPhoto.value = false
    cameraOpen.value = false
  }
}

function retakePhoto() {
  ocrMessage.value = ''
  cameraOpen.value = true
}

async function skipNotes() {
  notes.value = ''
  await next()
}
</script>

<template>
  <section class="d-page">
    <PageHeader
      eyebrow="New pickup"
      :title="STEP_TITLES[step]"
      back-to="/"
      back-label="Home"
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
      v-if="hydrating"
      class="note"
      role="status"
    >
      <span>Resuming your pickup…</span>
    </p>

    <p
      v-if="errorMessage"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ errorMessage }}</span>
    </p>

    <p
      v-if="existingTripId && !tripId"
      class="note"
      role="status"
    >
      <span>
        You already have a pickup in progress.
        <button
          type="button"
          class="font-semibold underline"
          @click="hydrateFromTrip(existingTripId)"
        >
          Continue it
        </button>
        instead of starting another.
      </span>
    </p>

    <!-- ── What are you picking up? ────────────────────────────── -->
    <template v-if="step === 'kind'">
      <div class="choice-grid">
        <button
          type="button"
          class="choice-card"
          :aria-pressed="pickupKind === 'CONTAINER'"
          @click="pickupKind = 'CONTAINER'"
        >
          {{ TRIP_KIND_LABELS.CONTAINER }}
          <small>Box and chassis</small>
        </button>
        <button
          type="button"
          class="choice-card"
          :aria-pressed="pickupKind === 'BARE_CHASSIS'"
          @click="pickupKind = 'BARE_CHASSIS'"
        >
          {{ TRIP_KIND_LABELS.BARE_CHASSIS }}
          <small>Chassis only — add a container later from Home</small>
        </button>
      </div>
    </template>

    <!-- ── Location ────────────────────────────────────────────── -->
    <template v-else-if="step === 'location'">
      <div class="searchbar">
        <span aria-hidden="true">⌕</span>
        <input
          v-model="locationSearch"
          type="search"
          placeholder="Search yards, terminals, customers…"
          aria-label="Search locations"
        >
      </div>

      <div
        v-if="locationData?.items.length"
        class="card rowlist"
      >
        <button
          v-for="location in locationData.items"
          :key="location.id"
          type="button"
          class="row"
          :aria-pressed="originLocationId === location.id"
          @click="originLocationId = location.id"
        >
          <span
            class="row-ico"
            aria-hidden="true"
          >{{ LOCATION_GLYPH[location.type] }}</span>
          <span class="row-main">
            <b>{{ location.name }}</b>
            <small>{{ [location.addressLine1, location.city].filter(Boolean).join(' · ') || '—' }}</small>
          </span>
          <span class="row-end">
            <StatusChip
              v-if="originLocationId === location.id"
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
        v-if="!locationData?.items.length"
        glyph="◫"
        title="No locations match"
        description="Pick an existing yard, terminal, or customer. Add new ones from More → Customers & locations."
      />
    </template>

    <!-- ── Container + chassis (one photo) ──────────────────────── -->
    <template v-else-if="step === 'equipment'">
      <ScanPhotoPeek
        v-if="capturedPhoto && !cameraOpen"
        :src="capturedPhoto"
      />
      <div class="card p-4">
        <label
          v-if="pickupKind === 'CONTAINER'"
          class="field"
          for="container-number"
        >
          <span>Container number</span>
          <div class="field-row">
            <ContainerNumberInput
              id="container-number"
              v-model="rawNumber"
              :disabled="Boolean(tripId)"
              :invalid="containerState === 'error'"
            />
            <FieldStatus
              :state="containerState"
              :detail="containerDetail"
              label="container number"
            />
          </div>
          <small class="field-hint">Four letters, six digits, then the boxed check digit.</small>
        </label>

        <label
          class="field !mb-0"
          :class="{ 'mt-5': pickupKind === 'CONTAINER' }"
          for="chassis-number"
        >
          <span>Chassis number</span>
          <div class="field-row">
            <ChassisNumberInput
              id="chassis-number"
              v-model="chassisNumber"
              :invalid="chassisState === 'error'"
            />
            <FieldStatus
              :state="chassisState"
              :detail="chassisDetail"
              label="chassis number"
            />
          </div>
          <small class="field-hint">{{ pickupKind === 'BARE_CHASSIS' ? 'Four letters and six digits.' : 'Four letters and six digits. Leave blank if there is no chassis.' }}</small>
        </label>
      </div>

      <div aria-live="polite">
        <p
          v-if="ocrMessage && !readingPhoto"
          class="note warn"
        >
          <span>{{ ocrMessage }}</span>
        </p>

        <p
          v-if="pickupKind === 'CONTAINER' && resolving"
          class="note"
        >
          <span>Checking the active container pool…</span>
        </p>
        <p
          v-else-if="pickupKind === 'CONTAINER' && resolution"
          class="note"
          :class="RESOLUTION_COPY[resolution.outcome]?.variant"
        >
          <span>
            <b>{{ RESOLUTION_COPY[resolution.outcome]?.title }}.</b>
            {{ resolution.message }}
          </span>
        </p>
      </div>

      <div
        v-if="pickupKind === 'CONTAINER' && resolution?.outcome === 'CONFLICT' && resolution.holder"
        class="card mt-4 p-4"
      >
        <span class="eyebrow">Current holder</span>
        <div class="trip-facts mt-3 !border-t-0 !pt-0">
          <div class="trip-fact">
            <small>Driver</small>
            <b>{{ resolution.holder.driverName }}</b>
          </div>
          <div class="trip-fact">
            <small>State</small>
            <b>{{ ACTIVE_POOL_LABELS[resolution.holder.activePoolState as keyof typeof ACTIVE_POOL_LABELS] }}</b>
          </div>
          <div class="trip-fact">
            <small>Believed at</small>
            <b>{{ resolution.holder.believedLocationName ?? 'In transit' }}</b>
          </div>
        </div>
        <p class="mt-4 text-sm text-[var(--color-ink-500)]">
          A second pickup cannot be started for this container. Contact dispatch or an administrator to
          resolve the conflict.
        </p>
      </div>

      <button
        v-if="!tripId"
        type="button"
        class="btn-ghost mt-4 w-full"
        :disabled="readingPhoto"
        @click="retakePhoto"
      >
        {{ capturedPhoto ? 'Retake photo' : 'Open camera' }}
      </button>
    </template>

    <!-- ── Container type (new records only) ───────────────────── -->
    <template v-else-if="step === 'containerType'">
      <div class="choice-grid cols-2">
        <button
          v-for="type in CONTAINER_TYPES"
          :key="type"
          type="button"
          class="choice-card"
          :aria-pressed="containerType === type"
          :disabled="Boolean(tripId)"
          @click="containerType = type"
        >
          {{ CONTAINER_TYPE_LABELS[type] }}
        </button>
      </div>
    </template>

    <!-- ── Equipment type (new records only) ───────────────────── -->
    <template v-else-if="step === 'equipmentType'">
      <div class="choice-grid cols-2">
        <button
          v-for="type in EQUIPMENT_TYPES"
          :key="type"
          type="button"
          class="choice-card"
          :aria-pressed="equipmentType === type"
          :disabled="Boolean(tripId)"
          @click="equipmentType = type"
        >
          {{ EQUIPMENT_TYPE_LABELS[type] }}
        </button>
      </div>
    </template>

    <!-- ── Load state ──────────────────────────────────────────── -->
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
          <small>Bobtail or empty move</small>
        </button>
      </div>
    </template>

    <!-- ── Seal ────────────────────────────────────────────────── -->
    <template v-else-if="step === 'seal'">
      <div class="card p-4">
        <label class="field !mb-0">
          <span>Seal number</span>
          <input
            v-model="sealNumber"
            class="input mono"
            placeholder="004512"
            autocapitalize="characters"
            autocomplete="off"
          >
          <small class="field-hint">Leave blank if the container is unsealed.</small>
        </label>
      </div>
    </template>

    <!-- ── Notes ───────────────────────────────────────────────── -->
    <template v-else-if="step === 'notes'">
      <div class="card p-4">
        <label class="field !mb-0">
          <span>Notes</span>
          <textarea
            v-model="notes"
            class="textarea"
            placeholder="Damage, exceptions, gate instructions…"
          />
        </label>
      </div>
      <button
        type="button"
        class="btn-ghost mt-4 w-full"
        @click="skipNotes"
      >
        Skip notes
      </button>
    </template>

    <!-- ── Confirm ─────────────────────────────────────────────── -->
    <template v-else-if="step === 'confirm'">
      <TripCard
        :trip-kind="pickupKind"
        :container-type="pickupKind === 'CONTAINER' ? containerType : null"
        :is-loaded="pickupKind === 'CONTAINER' ? isLoaded : false"
        :container-number="pickupKind === 'CONTAINER' ? formatContainerNumber(normalized) : ''"
        :equipment-type="pickupKind === 'CONTAINER' ? equipmentType : null"
        :chassis-number="chassisNumber ? formatChassisNumber(chassisNumber) : undefined"
        :seal-number="pickupKind === 'CONTAINER' ? sealNumber : ''"
        :origin-name="originLocation?.name"
        destination-name="Chosen on arrival"
        origin-label="Pickup"
      />

      <p class="note">
        <span>
          {{
            pickupKind === 'BARE_CHASSIS'
              ? 'Confirming records the chassis pickup and departure. You can hang a container on it from Home.'
              : 'Confirming records the pickup and puts the container in transit on this service life.'
          }}
        </span>
      </p>

      <button
        class="btn-primary-action"
        :disabled="submitting"
        @click="confirm"
      >
        {{ submitting ? 'Confirming…' : 'Confirm Pickup' }}
      </button>
    </template>

    <!-- ── Navigation ──────────────────────────────────────────── -->
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
        {{ submitting ? 'Working…' : 'Continue' }}
      </button>
    </div>

    <button
      type="button"
      class="mt-4 w-full py-3 text-sm font-semibold text-[var(--color-err-600)]"
      @click="abandon"
    >
      {{ tripId ? 'Cancel this pickup' : 'Discard and go home' }}
    </button>

    <CaptureCamera
      v-if="cameraOpen"
      :title="pickupKind === 'BARE_CHASSIS' ? 'Chassis' : 'Container and chassis'"
      :reading-label="pickupKind === 'BARE_CHASSIS' ? 'Reading the chassis number…' : 'Reading container and chassis numbers…'"
      @close="cameraOpen = false"
      @photo="onPhoto"
    />
  </section>
</template>
