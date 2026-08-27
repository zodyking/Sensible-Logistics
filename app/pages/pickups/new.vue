<script setup lang="ts">
import { ACTIVE_POOL_LABELS, CONTAINER_TYPES, CONTAINER_TYPE_LABELS, EQUIPMENT_TYPES, EQUIPMENT_TYPE_LABELS, LOCATION_GLYPH } from '#shared/utils/domain'
import type { ContainerType, EquipmentType } from '#shared/utils/domain'
import { formatContainerNumber, normalizeContainerNumber, validateContainerNumber } from '#shared/utils/iso6346'

useHead({ title: 'New pickup' })

type Step = 'location' | 'container' | 'containerType' | 'equipmentType' | 'chassis' | 'load' | 'seal' | 'notes' | 'confirm'

const STEP_TITLES: Record<Step, string> = {
  location: 'Where are you picking up?',
  container: 'Container number',
  containerType: 'Container type',
  equipmentType: 'Equipment size',
  chassis: 'Chassis number',
  load: 'Loaded or empty?',
  seal: 'Seal number',
  notes: 'Notes',
  confirm: 'Confirm pickup',
}

const originLocationId = ref<string | null>(null)
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
  const steps: Step[] = ['location', 'container']
  if (needsClassification.value) {
    steps.push('containerType', 'equipmentType')
  }
  steps.push('chassis', 'load')
  if (isLoaded.value) steps.push('seal')
  steps.push('notes', 'confirm')
  return steps
})

const step = ref<Step>('location')
const stepIndex = computed(() => Math.max(0, STEPS.value.indexOf(step.value)))

watch(STEPS, (steps) => {
  if (steps.includes(step.value)) return
  const order: Step[] = ['location', 'container', 'containerType', 'equipmentType', 'chassis', 'load', 'seal', 'notes', 'confirm']
  const from = order.indexOf(step.value)
  const following = order.slice(from + 1).find(name => steps.includes(name))
  const previous = [...order.slice(0, Math.max(0, from))].reverse().find(name => steps.includes(name))
  step.value = following ?? previous ?? 'location'
})

/* --- Data sources ----------------------------------------------- */
const locationSearch = ref('')
const { data: locationData } = await useFetch('/api/locations', {
  query: computed(() => ({ q: locationSearch.value || undefined, limit: 50 })),
})

const originLocation = computed(() =>
  locationData.value?.items.find(l => l.id === originLocationId.value) ?? null)

const route = useRoute()
rawNumber.value = String(route.query.number ?? '')
if (route.query.chassis) chassisNumber.value = String(route.query.chassis)

const submitting = ref(false)
const errorMessage = ref('')
const cameraFor = ref<'container' | 'chassis' | null>(null)

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
    rawNumber.value = data.container?.numberNormalized ?? data.container?.number ?? ''
    if (data.container?.containerType) containerType.value = data.container.containerType
    if (data.container?.equipmentType) equipmentType.value = data.container.equipmentType
    chassisId.value = data.trip.chassisId
    chassisNumber.value = data.chassis?.number ?? ''
    isLoaded.value = Boolean(data.trip.isLoaded)
    sealNumber.value = data.trip.sealNumber ?? ''
    notes.value = data.trip.driverNotes ?? ''
    step.value = 'chassis'
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

const claimStep = computed<Step>(() => needsClassification.value ? 'equipmentType' : 'container')

const canAdvance = computed(() => {
  switch (step.value) {
    case 'location':
      return Boolean(originLocationId.value)
    case 'container':
      return validation.value.structureValid && !blockedByConflict.value && !resolving.value && Boolean(resolution.value)
    case 'containerType':
    case 'equipmentType':
    case 'chassis':
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

  if (step.value === 'chassis') {
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
  submitting.value = true
  try {
    const result = await $fetch('/api/pickups/start', {
      method: 'POST',
      body: {
        eventId: crypto.randomUUID(),
        containerNumber: normalized.value,
        containerType: containerType.value,
        equipmentType: equipmentType.value,
        originLocationId: originLocationId.value,
      },
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
        isLoaded: isLoaded.value,
        sealNumber: sealNumber.value || null,
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

function onCaptured(value: string) {
  if (cameraFor.value === 'chassis') {
    chassisNumber.value = value
  }
  else {
    rawNumber.value = value
  }
  cameraFor.value = null
}

async function skipChassis() {
  chassisId.value = null
  chassisNumber.value = ''
  await next()
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
      class="banner info"
      role="status"
    >
      <span aria-hidden="true">▸</span>
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
      class="banner info"
      role="status"
    >
      <span aria-hidden="true">▸</span>
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

    <!-- ── Location ────────────────────────────────────────────── -->
    <template v-if="step === 'location'">
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
        description="Create the yard, terminal or customer you are working from."
      />

      <NuxtLink
        :to="{ path: '/locations/new', query: { returnTo: '/pickups/new' } }"
        class="btn-ghost mt-4 w-full"
      >
        Add a location
      </NuxtLink>
    </template>

    <!-- ── Container number ────────────────────────────────────── -->
    <template v-else-if="step === 'container'">
      <button
        type="button"
        class="btn-primary-action"
        :disabled="Boolean(tripId)"
        @click="cameraFor = 'container'"
      >
        Take photo
      </button>

      <p class="my-4 text-center text-sm font-semibold text-[var(--color-ink-500)]">
        or type it
      </p>

      <div class="card p-4">
        <label class="field !mb-0">
          <span>Container number</span>
          <input
            v-model="rawNumber"
            class="input mono"
            :class="{ invalid: showValidation && !validation.structureValid }"
            placeholder="MSCU4521894"
            autocapitalize="characters"
            autocomplete="off"
            spellcheck="false"
            maxlength="15"
            :readonly="Boolean(tripId)"
            aria-describedby="container-validation"
          >
          <small class="field-hint">Four letters, six digits and a check digit.</small>
        </label>

        <div
          id="container-validation"
          aria-live="polite"
        >
          <template v-if="showValidation">
            <p
              v-if="validation.valid"
              class="banner ok mt-3 mb-0"
            >
              <span aria-hidden="true">✓</span>
              <span>
                <b>{{ formatContainerNumber(normalized) }}</b>
                ISO 6346 check digit is valid.
              </span>
            </p>

            <p
              v-else
              class="banner warn mt-3 mb-0"
            >
              <span aria-hidden="true">!</span>
              <span>
                <b>Check the number</b>
                {{ validation.errors[0] }}
                <template v-if="validation.expectedCheckDigit !== null">
                  Expected check digit {{ validation.expectedCheckDigit }}.
                </template>
              </span>
            </p>

            <p
              v-for="warning in validation.warnings"
              :key="warning"
              class="banner info mt-2 mb-0"
            >
              <span aria-hidden="true">▸</span>
              <span>{{ warning }}</span>
            </p>
          </template>
        </div>
      </div>

      <div
        v-if="resolving"
        class="banner info mt-4"
        role="status"
      >
        <span aria-hidden="true">▸</span>
        <span>Checking the active container pool…</span>
      </div>

      <template v-else-if="resolution">
        <div
          class="banner mt-4"
          :class="RESOLUTION_COPY[resolution.outcome]?.variant"
          role="status"
        >
          <span aria-hidden="true">▸</span>
          <span>
            <b>{{ RESOLUTION_COPY[resolution.outcome]?.title }}</b>
            {{ resolution.message }}
          </span>
        </div>

        <div
          v-if="resolution.outcome === 'CONFLICT' && resolution.holder"
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
      </template>
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

    <!-- ── Chassis number ──────────────────────────────────────── -->
    <template v-else-if="step === 'chassis'">
      <button
        type="button"
        class="btn-primary-action"
        @click="cameraFor = 'chassis'"
      >
        Take photo
      </button>

      <p class="my-4 text-center text-sm font-semibold text-[var(--color-ink-500)]">
        or type it
      </p>

      <div class="card p-4">
        <label class="field !mb-0">
          <span>Chassis number</span>
          <input
            v-model="chassisNumber"
            class="input mono"
            placeholder="TRAC481029"
            autocapitalize="characters"
            autocomplete="off"
            spellcheck="false"
            maxlength="20"
          >
        </label>
      </div>

      <button
        type="button"
        class="btn-ghost mt-4 w-full"
        @click="skipChassis"
      >
        No chassis
      </button>
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
    <template v-else>
      <TripCard
        :container-type="containerType"
        :is-loaded="isLoaded"
        :container-number="formatContainerNumber(normalized)"
        :equipment-type="equipmentType"
        :chassis-number="chassisNumber || undefined"
        :seal-number="sealNumber"
        :origin-name="originLocation?.name"
        destination-name="Chosen on arrival"
        origin-label="Pickup"
      />

      <p class="banner info">
        <span aria-hidden="true">▸</span>
        <span>Confirming records the pickup, custody and departure events and moves the container into your custody.</span>
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
      v-if="cameraFor"
      :profile="cameraFor"
      @close="cameraFor = null"
      @captured="onCaptured"
    />
  </section>
</template>
