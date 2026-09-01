<script setup lang="ts">
import { CONTAINER_TYPES, CONTAINER_TYPE_LABELS, PICKUP_EQUIPMENT_SIZES, PICKUP_EQUIPMENT_SIZE_LABELS, pickupEquipmentSizeLabel } from '#shared/utils/domain'
import type { ContainerType, EquipmentType } from '#shared/utils/domain'
import {
  formatContainerNumber,
  maskContainerInput,
  normalizeContainerNumber,
  validateContainerNumber,
} from '#shared/utils/iso6346'
import { driverOcrMessage } from '#shared/utils/ocr-parse'

const { user } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')

const route = useRoute()
const locationId = computed(() => String(route.params.id))

const { data: locationData } = await useFetch(() => `/api/locations/${locationId.value}`)

useHead({ title: 'Add container' })

type Step = 'number' | 'containerType' | 'equipmentType' | 'confirm'
const STEP_TITLES: Record<Step, string> = {
  number: 'Container',
  containerType: 'Container type',
  equipmentType: 'Container size',
  confirm: 'Confirm container',
}

const rawNumber = ref('')
const containerType = ref<ContainerType>('TROPICAL')
const equipmentType = ref<EquipmentType>('DRY_40')
const isLoaded = ref(true)
const submitting = ref(false)
const errorMessage = ref('')
const capturedPhoto = ref('')
const readingPhoto = ref(false)
const ocrMessage = ref('')

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
  steps.push('confirm')
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
      return validation.value.structureValid
        && !blocked.value
        && !resolving.value
        && Boolean(resolution.value)
        && !readingPhoto.value
    case 'containerType':
    case 'equipmentType':
    case 'confirm':
      return true
  }
  return false
})

function next() {
  errorMessage.value = ''
  const index = stepIndex.value
  if (index < STEPS.value.length - 1) step.value = STEPS.value[index + 1]!
}

function back() {
  const index = stepIndex.value
  if (index > 0) step.value = STEPS.value[index - 1]!
}

async function confirm() {
  if (submitting.value) return
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

async function onPhoto(dataUrl: string) {
  capturedPhoto.value = dataUrl
  readingPhoto.value = true
  ocrMessage.value = ''
  errorMessage.value = ''
  await nextTick()
  const startedAt = Date.now()
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
    await waitAtLeast(startedAt, PHOTO_READ_MIN_MS)
    readingPhoto.value = false
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
      <ScanReadingLoader
        v-if="readingPhoto"
        label="Reading the photo…"
      />
      <template v-else>
        <ScanPhotoPeek
          v-if="capturedPhoto"
          :src="capturedPhoto"
        />
        <div class="wiz-hero">
          <span class="wiz-hero-badge">
            <EquipmentIcon
              name="container"
              :size="54"
            />
          </span>
          <b>Container</b>
        </div>

        <span class="wiz-label">Container info</span>
        <div class="wiz-group">
          <div class="wiz-row">
            <label
              class="wiz-row-label"
              for="add-container-number"
            >Number</label>
            <ContainerNumberInput
              id="add-container-number"
              v-model="rawNumber"
              :invalid="showValidation && !validation.structureValid"
              describedby="add-container-validation"
            />
          </div>
        </div>

        <span class="wiz-label">Container status</span>
        <div class="wiz-group">
          <div class="wiz-status">
            <button
              type="button"
              class="wiz-status-btn"
              :aria-pressed="!isLoaded"
              @click="isLoaded = false"
            >
              <span
                class="wiz-status-mark"
                aria-hidden="true"
              >E</span>
              <span class="wiz-status-name">Empty</span>
            </button>
            <button
              type="button"
              class="wiz-status-btn"
              :aria-pressed="isLoaded"
              @click="isLoaded = true"
            >
              <span
                class="wiz-status-mark"
                aria-hidden="true"
              >L</span>
              <span class="wiz-status-name">Load</span>
            </button>
          </div>
        </div>

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
        <p
          v-if="ocrMessage && !readingPhoto"
          class="note warn mt-4"
        >
          <span>{{ ocrMessage }}</span>
        </p>
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
        <DevicePhotoInput
          class="btn-ghost mt-4 w-full"
          :label="capturedPhoto ? 'Retake photo' : 'Take photo'"
          :disabled="readingPhoto"
          @photo="onPhoto"
        />
      </template>
    </template>

    <template v-else-if="step === 'containerType'">
      <div class="choice-grid">
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
      <div class="choice-grid">
        <button
          v-for="type in PICKUP_EQUIPMENT_SIZES"
          :key="type"
          type="button"
          class="choice-card"
          :aria-pressed="equipmentType === type"
          @click="equipmentType = type"
        >
          {{ PICKUP_EQUIPMENT_SIZE_LABELS[type] }}
        </button>
      </div>
    </template>

    <template v-else>
      <div class="card p-4">
        <span class="eyebrow">On site</span>
        <b class="mt-2 block font-mono text-lg">{{ formatContainerNumber(normalized) }}</b>
        <p class="mt-2 text-sm text-[var(--color-ink-500)]">
          {{ CONTAINER_TYPE_LABELS[containerType] }}
          · {{ pickupEquipmentSizeLabel(equipmentType) }}
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
