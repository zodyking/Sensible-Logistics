<script setup lang="ts">
import { ACTIVE_POOL_LABELS, CONTAINER_TYPES, CONTAINER_TYPE_LABELS, PICKUP_EQUIPMENT_SIZES, PICKUP_EQUIPMENT_SIZE_LABELS } from '#shared/utils/domain'
import type { ContainerType, EquipmentType } from '#shared/utils/domain'
import {
  formatChassisNumber,
  formatContainerNumber,
  maskContainerInput,
  normalizeContainerNumber,
  validateContainerNumber,
} from '#shared/utils/iso6346'
import { driverOcrMessage } from '#shared/utils/ocr-parse'
import { rememberTripPhoto } from '~/utils/trip-share-files'

useHead({ title: 'Add container' })

type Step = 'equipment' | 'containerType' | 'equipmentType' | 'seal' | 'confirm'

const STEP_TITLES: Record<Step, string> = {
  equipment: 'Container and chassis',
  containerType: 'Container type',
  equipmentType: 'Container size',
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
const containerType = ref<ContainerType | null>(null)
const equipmentType = ref<EquipmentType | null>(null)
const isLoaded = ref<boolean | null>(null)
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
  if (isLoaded.value === true) steps.push('seal')
  steps.push('confirm')
  return steps
})

const step = ref<Step>('equipment')
watch(step, scrollWizardToTop)
const stepIndex = computed(() => Math.max(0, STEPS.value.indexOf(step.value)))

watch(STEPS, (steps) => {
  if (steps.includes(step.value)) return
  const order: Step[] = ['equipment', 'containerType', 'equipmentType', 'seal', 'confirm']
  const from = order.indexOf(step.value)
  const following = order.slice(from + 1).find(name => steps.includes(name))
  const previous = [...order.slice(0, Math.max(0, from))].reverse().find(name => steps.includes(name))
  step.value = following ?? previous ?? 'equipment'
})

const submitting = ref(false)
const errorMessage = ref('')
const capturedPhoto = ref('')
const readingPhoto = ref(false)
const ocrMessage = ref('')
const resolving = ref(false)
const {
  hold: driverHold,
  releasing: driverReleasing,
  promptText: driverHoldText,
  decide: decideDriverRelease,
  releaseIfNeeded: releaseDriverIfNeeded,
} = useDriverReleasePrompt()
const promptedDriverHold = ref('')

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
    if (resolution.value.outcome === 'CONFLICT' && resolution.value.holder && found?.id) {
      if (promptedDriverHold.value !== found.id) {
        promptedDriverHold.value = found.id
        const released = await releaseDriverIfNeeded({
          containerId: found.id,
          driverName: resolution.value.holder.driverName,
          containerNumber: found.number,
        })
        if (released) resolution.value = await resolveNumber(normalized.value)
      }
    }
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
  promptedDriverHold.value = ''
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
        && isLoaded.value !== null
        && !blockedByConflict.value
        && !resolving.value
        && Boolean(resolution.value)
        && !readingPhoto.value
    case 'containerType':
      return Boolean(containerType.value)
    case 'equipmentType':
      return Boolean(equipmentType.value)
    case 'confirm':
      return Boolean(containerType.value) && Boolean(equipmentType.value) && isLoaded.value !== null
    case 'seal':
      return Boolean(sealNumber.value.trim())
  }
  return false
})

async function next() {
  errorMessage.value = ''
  const index = stepIndex.value
  if (index < STEPS.value.length - 1) step.value = STEPS.value[index + 1]!
}

/** Classification rows commit and move on; typed screens keep the button. */
async function pickContainerType(type: ContainerType) {
  containerType.value = type
  await next()
}

async function pickEquipmentType(type: EquipmentType) {
  equipmentType.value = type
  await next()
}

const showNext = computed(() => step.value !== 'containerType' && step.value !== 'equipmentType')

function back() {
  const index = stepIndex.value
  if (index > 0) step.value = STEPS.value[index - 1]!
}

async function attach() {
  if (!tripId.value || submitting.value) return
  if (isLoaded.value === null) {
    errorMessage.value = 'Choose empty or load.'
    return
  }
  if (!containerType.value || !equipmentType.value) {
    errorMessage.value = 'Choose container type and size.'
    return
  }
  if (isLoaded.value && !sealNumber.value.trim()) {
    errorMessage.value = 'Enter a seal number for a loaded container.'
    step.value = 'seal'
    return
  }
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
        sealNumber: isLoaded.value ? (sealNumber.value.trim() || null) : null,
      },
    })
    if (tripId.value && capturedPhoto.value) {
      await rememberTripPhoto(tripId.value, capturedPhoto.value, {
        containerNumber: normalized.value,
        chassisNumber: chassisNumber.value,
      })
    }
    await navigateTo('/')
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not add the container to this chassis.')
  }
  finally {
    submitting.value = false
  }
}

watch([tripId, capturedPhoto, normalized, chassisNumber], ([id, photo]) => {
  if (id && photo) {
    void rememberTripPhoto(id, photo, {
      containerNumber: normalized.value,
      chassisNumber: chassisNumber.value,
    })
  }
})

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
  <section class="d-page">
    <WizardNav
      :title="STEP_TITLES[step]"
      :back-label="stepIndex > 0 ? 'Back' : 'Home'"
      :back-to="stepIndex > 0 ? undefined : '/'"
      @back="back"
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
      <p
        v-if="errorMessage"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ errorMessage }}</span>
      </p>

      <template v-if="step === 'equipment'">
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
                for="attach-container"
              >Number</label>
              <ContainerNumberInput
                id="attach-container"
                v-model="rawNumber"
                :invalid="containerState === 'error'"
              />
              <FieldStatus
                :state="containerState"
                :detail="containerDetail || 'Four letters, six digits, then the boxed check digit.'"
                label="container number"
              />
            </div>
          </div>

          <span class="wiz-label">Container status</span>
          <div class="wiz-group">
            <div class="wiz-status">
              <button
                type="button"
                class="wiz-status-btn"
                :aria-pressed="isLoaded === false"
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
                :aria-pressed="isLoaded === true"
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

          <span class="wiz-label">Chassis info</span>
          <div class="wiz-group">
            <div class="wiz-row">
              <span class="wiz-row-label">Number</span>
              <span class="mono flex-1 text-[var(--color-ink-700)]">
                {{ chassisNumber ? formatChassisNumber(chassisNumber) : 'On this trip' }}
              </span>
            </div>
          </div>
          <p class="wiz-hint">
            This chassis is live on your trip. Scan or type the container you are hanging on it.
          </p>

          <div aria-live="polite">
            <p
              v-if="ocrMessage && !readingPhoto"
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

          <DevicePhotoInput
            class="btn-ghost mt-5 w-full"
            :label="capturedPhoto ? 'Retake photo' : 'Scan with the camera'"
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

      <template v-else-if="step === 'seal'">
        <span class="wiz-label">Seal</span>
        <div class="wiz-group">
          <div class="wiz-row">
            <label
              class="wiz-row-label"
              for="attach-seal"
            >Number</label>
            <input
              id="attach-seal"
              v-model="sealNumber"
              class="input mono"
              placeholder="required"
              autocapitalize="characters"
              autocomplete="off"
              required
            >
          </div>
        </div>
        <p class="wiz-hint">
          A loaded container carries its seal on the trip.
        </p>
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

        <p class="wiz-hint">
          This hangs the container on the live chassis and puts the box in your custody.
        </p>
      </template>

      <div
        v-if="!(step === 'equipment' && readingPhoto)"
        class="wiz-actions"
      >
        <button
          v-if="step === 'confirm'"
          type="button"
          class="wiz-next"
          :disabled="submitting || !canAdvance"
          @click="attach"
        >
          {{ submitting ? 'Saving…' : 'Add container to chassis' }}
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
    </template>

    <ChassisReleaseSheet
      :open="Boolean(driverHold)"
      title="Driver has this container"
      :message="driverHoldText"
      cancel-label="Keep it with them"
      confirm-label="Release and proceed"
      :busy="driverReleasing"
      @close="decideDriverRelease(false)"
      @confirm="decideDriverRelease(true)"
    />
  </section>
</template>
