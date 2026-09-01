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
watch(step, scrollWizardToTop)
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

/** Classification rows commit and move on; typed screens keep the button. */
function pickContainerType(type: ContainerType) {
  containerType.value = type
  next()
}

function pickEquipmentType(type: EquipmentType) {
  equipmentType.value = type
  next()
}

const showNext = computed(() => step.value !== 'containerType' && step.value !== 'equipmentType')

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
    <WizardNav
      :title="STEP_TITLES[step]"
      :back-label="stepIndex > 0 ? 'Back' : (locationData?.location.name ?? 'Location')"
      :back-to="stepIndex > 0 ? undefined : `/locations/${locationId}`"
      @back="back"
    />

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
              :size="60"
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
      <span class="wiz-label">Container type</span>
      <div class="wiz-group">
        <button
          v-for="type in CONTAINER_TYPES"
          :key="type"
          type="button"
          class="wiz-pick"
          :aria-pressed="containerType === type"
          @click="pickContainerType(type)"
        >
          <span class="wiz-pick-main">
            <b>{{ CONTAINER_TYPE_LABELS[type] }}</b>
          </span>
          <span
            v-if="containerType === type"
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

    <template v-else-if="step === 'equipmentType'">
      <span class="wiz-label">Container size</span>
      <div class="wiz-group">
        <button
          v-for="type in PICKUP_EQUIPMENT_SIZES"
          :key="type"
          type="button"
          class="wiz-pick"
          :aria-pressed="equipmentType === type"
          @click="pickEquipmentType(type)"
        >
          <span class="wiz-pick-main">
            <b>{{ PICKUP_EQUIPMENT_SIZE_LABELS[type] }}</b>
          </span>
          <span
            v-if="equipmentType === type"
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

    <template v-else>
      <span class="wiz-label">On site</span>
      <div class="wiz-group">
        <div class="wiz-row">
          <span class="wiz-row-label">Number</span>
          <span class="mono flex-1">{{ formatContainerNumber(normalized) }}</span>
        </div>
        <div class="wiz-row">
          <span class="wiz-row-label">Box</span>
          <span class="flex-1 text-[var(--color-ink-700)]">
            {{ CONTAINER_TYPE_LABELS[containerType] }}
            · {{ pickupEquipmentSizeLabel(equipmentType) }}
            · {{ isLoaded ? 'Loaded' : 'Empty' }}
          </span>
        </div>
        <div class="wiz-row">
          <span class="wiz-row-label">Where</span>
          <span class="flex-1 text-[var(--color-ink-700)]">{{ locationData?.location.name }}</span>
        </div>
      </div>
    </template>

    <div class="wiz-actions">
      <button
        v-if="step === 'confirm'"
        type="button"
        class="wiz-next"
        :disabled="submitting"
        @click="confirm"
      >
        {{ submitting ? 'Saving…' : 'Save container' }}
      </button>
      <button
        v-else-if="showNext"
        type="button"
        class="wiz-next"
        :disabled="!canAdvance || submitting"
        @click="next"
      >
        Next
      </button>
    </div>
  </section>
</template>
