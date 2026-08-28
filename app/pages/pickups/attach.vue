<script setup lang="ts">
import { ACTIVE_POOL_LABELS, CONTAINER_TYPES, CONTAINER_TYPE_LABELS, EQUIPMENT_TYPES, EQUIPMENT_TYPE_LABELS } from '#shared/utils/domain'
import type { ContainerType, EquipmentType } from '#shared/utils/domain'
import {
  formatContainerNumber,
  maskContainerInput,
  normalizeContainerNumber,
  validateContainerNumber,
} from '#shared/utils/iso6346'
import { driverOcrMessage } from '#shared/utils/ocr-parse'

useHead({ title: 'Add container' })

type Step = 'equipment' | 'containerType' | 'equipmentType' | 'load' | 'seal' | 'confirm'

const STEP_TITLES: Record<Step, string> = {
  equipment: 'Container number',
  containerType: 'Container type',
  equipmentType: 'Equipment size',
  load: 'Loaded or empty?',
  seal: 'Seal number',
  confirm: 'Hang the container',
}

const { data: home, error: homeError } = await useFetch('/api/home')

const active = computed(() => home.value?.active ?? null)
const tripId = computed(() => active.value?.trip.id ?? null)
const chassisNumber = computed(() => active.value?.chassis?.number ?? '')

const canAttach = computed(() =>
  Boolean(
    active.value
    && active.value.chassis
    && !active.value.container
    && active.value.trip.status !== 'PICKUP_IN_PROGRESS',
  ),
)

const rawNumber = ref('')
const containerType = ref<ContainerType>('TROPICAL')
const equipmentType = ref<EquipmentType>('HC_40')
const isLoaded = ref(true)
const sealNumber = ref('')

function resolveNumber(number: string) {
  return $fetch('/api/containers/resolve', { query: { number } })
}

type Resolution = Awaited<ReturnType<typeof resolveNumber>>
const resolution = ref<Resolution | null>(null)
const needsClassification = computed(() => resolution.value?.outcome === 'CREATE')

const STEPS = computed<Step[]>(() => {
  const steps: Step[] = ['equipment']
  if (needsClassification.value) steps.push('containerType', 'equipmentType')
  steps.push('load')
  if (isLoaded.value) steps.push('seal')
  steps.push('confirm')
  return steps
})

const step = ref<Step>('equipment')
const stepIndex = computed(() => Math.max(0, STEPS.value.indexOf(step.value)))

watch(STEPS, (steps) => {
  if (steps.includes(step.value)) return
  const order: Step[] = ['equipment', 'containerType', 'equipmentType', 'load', 'seal', 'confirm']
  const from = order.indexOf(step.value)
  const following = order.slice(from + 1).find(name => steps.includes(name))
  const previous = [...order.slice(0, Math.max(0, from))].reverse().find(name => steps.includes(name))
  step.value = following ?? previous ?? 'equipment'
})

const submitting = ref(false)
const errorMessage = ref('')
const cameraOpen = ref(false)
const capturedPhoto = ref('')
const readingPhoto = ref(false)
const ocrMessage = ref('')
const cameraAutoOpened = ref(false)
const resolving = ref(false)

const normalized = computed(() => normalizeContainerNumber(rawNumber.value))
const validation = computed(() => validateContainerNumber(rawNumber.value))
const showValidation = computed(() => normalized.value.length >= 11)

/* --- Field status: a mark on the field, wording only when asked --- */
const containerState = computed<'ok' | 'error' | 'idle'>(() => {
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

const canAdvance = computed(() => {
  switch (step.value) {
    case 'equipment':
      return validation.value.structureValid
        && !blockedByConflict.value
        && !resolving.value
        && Boolean(resolution.value)
        && !readingPhoto.value
    case 'containerType':
    case 'equipmentType':
    case 'load':
    case 'seal':
    case 'confirm':
      return true
  }
  return false
})

async function next() {
  errorMessage.value = ''
  const index = stepIndex.value
  if (index < STEPS.value.length - 1) step.value = STEPS.value[index + 1]!
}

function back() {
  const index = stepIndex.value
  if (index > 0) step.value = STEPS.value[index - 1]!
}

async function attach() {
  if (!tripId.value || submitting.value) return
  submitting.value = true
  errorMessage.value = ''
  try {
    await $fetch(`/api/trips/${tripId.value}/attach-container`, {
      method: 'POST',
      body: {
        eventId: crypto.randomUUID(),
        containerNumber: normalized.value,
        containerType: containerType.value,
        equipmentType: equipmentType.value,
        isLoaded: isLoaded.value,
        sealNumber: isLoaded.value ? (sealNumber.value || null) : null,
      },
    })
    await navigateTo('/')
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not add the container to this chassis.')
  }
  finally {
    submitting.value = false
  }
}

watch(step, (current) => {
  if (!canAttach.value) return
  if (current !== 'equipment') return
  if (cameraAutoOpened.value || rawNumber.value || cameraOpen.value) return
  cameraAutoOpened.value = true
  cameraOpen.value = true
}, { immediate: true })

async function onPhoto(dataUrl: string) {
  cameraOpen.value = false
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
    if (result.container) rawNumber.value = maskContainerInput(result.container)
    if (!result.container) {
      ocrMessage.value = result.message || 'No container number could be read. Edit the field or retake.'
    }
  }
  catch (error) {
    ocrMessage.value = driverOcrMessage(
      apiErrorMessage(error, 'Could not read the photo. Edit the field or retake.'),
      'Could not read the photo. Edit the field or retake.',
    )
  }
  finally {
    readingPhoto.value = false
  }
}

function retakePhoto() {
  ocrMessage.value = ''
  cameraOpen.value = true
}
</script>

<template>
  <section class="d-page">
    <PageHeader
      eyebrow="Add container"
      :title="STEP_TITLES[step]"
      back-to="/"
      back-label="Home"
    />

    <p
      v-if="homeError"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ apiErrorMessage(homeError, 'Could not load the live trip.') }}</span>
    </p>

    <p
      v-else-if="!canAttach"
      class="banner warn"
      role="status"
    >
      <span aria-hidden="true">!</span>
      <span>Hang a container from Home after you confirm a bare chassis pickup.</span>
    </p>

    <template v-else>
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

      <template v-if="step === 'equipment'">
        <div class="card p-4">
          <p class="mb-4 text-sm text-[var(--color-ink-500)]">
            Chassis {{ chassisNumber || 'on this trip' }} is live. Scan or type the container you are hanging on it.
          </p>
          <label
            class="field !mb-0"
            for="attach-container"
          >
            <span>Container number</span>
            <div class="field-row">
              <ContainerNumberInput
                id="attach-container"
                v-model="rawNumber"
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
        </div>

        <div aria-live="polite">
          <p
            v-if="readingPhoto"
            class="note"
          >
            <span>Reading the photo…</span>
          </p>
          <p
            v-else-if="ocrMessage"
            class="note warn"
          >
            <span>{{ ocrMessage }}</span>
          </p>

          <p
            v-if="resolving"
            class="note"
          >
            <span>Checking the active container pool…</span>
          </p>
          <p
            v-else-if="resolution"
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
          v-if="resolution?.outcome === 'CONFLICT' && resolution.holder"
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
          </div>
        </div>

        <button
          type="button"
          class="btn-ghost mt-4 w-full"
          :disabled="readingPhoto"
          @click="retakePhoto"
        >
          {{ capturedPhoto ? 'Retake photo' : 'Open camera' }}
        </button>
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
            <small>Hang an empty box</small>
          </button>
        </div>
      </template>

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

      <template v-else>
        <TripCard
          trip-kind="CONTAINER"
          :container-type="containerType"
          :is-loaded="isLoaded"
          :container-number="formatContainerNumber(normalized)"
          :equipment-type="equipmentType"
          :chassis-number="chassisNumber"
          :seal-number="sealNumber"
          :origin-name="active?.origin?.name"
          :destination-name="active?.destination?.name"
          origin-label="Pickup"
        />

        <p class="note">
          <span>This hangs the container on the live chassis and puts the box in your custody.</span>
        </p>

        <button
          class="btn-primary-action"
          :disabled="submitting"
          @click="attach"
        >
          {{ submitting ? 'Saving…' : 'Add container to chassis' }}
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

    <CaptureCamera
      v-if="cameraOpen"
      title="Container"
      @close="cameraOpen = false"
      @photo="onPhoto"
    />
  </section>
</template>
