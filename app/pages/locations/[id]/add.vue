<script setup lang="ts">
import {
  CONTAINER_TYPES,
  CONTAINER_TYPE_LABELS,
  PICKUP_EQUIPMENT_SIZES,
  PICKUP_EQUIPMENT_SIZE_LABELS,
  TRIP_KIND_LABELS,
  pickupEquipmentSizeLabel,
} from '#shared/utils/domain'
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
import { containerHasDriverClaim, containerIsHeldByDriver } from '#shared/utils/driver-hold'
import { driverOcrMessage } from '#shared/utils/ocr-parse'

const { user } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')

const route = useRoute()
const locationId = computed(() => String(route.params.id))

const { data: locationData } = await useFetch(() => `/api/locations/${locationId.value}`)

useHead({ title: 'Add Equipment' })

type Step = 'kind' | 'equipment' | 'containerType' | 'equipmentType' | 'confirm'
const STEP_TITLES: Record<Step, string> = {
  kind: 'Add Equipment',
  equipment: 'Container and chassis',
  containerType: 'Container type',
  equipmentType: 'Container size',
  confirm: 'Confirm',
}

const kind = ref<TripKind | null>(null)
const rawNumber = ref('')
const chassisNumber = ref('')
const containerType = ref<ContainerType | null>(null)
const equipmentType = ref<EquipmentType | null>(null)
const isLoaded = ref<boolean | null>(null)
const submitting = ref(false)
const errorMessage = ref('')
const capturedPhoto = ref('')
const readingPhoto = ref(false)
const ocrMessage = ref('')
const { conflict: chassisConflict, releasing: chassisReleasing, promptText: chassisConflictText, decide: decideChassisRelease, releaseIfNeeded } = useChassisReleasePrompt()
const {
  hold: driverHold,
  releasing: driverReleasing,
  promptText: driverHoldText,
  decide: decideDriverRelease,
  releaseIfNeeded: releaseDriverIfNeeded,
} = useDriverReleasePrompt()
const normalized = computed(() => normalizeContainerNumber(rawNumber.value))
const validation = computed(() => validateContainerNumber(rawNumber.value))
const showValidation = computed(() => kind.value === 'CONTAINER' && normalized.value.length >= 11)

type FieldState = 'idle' | 'ok' | 'error'
const chassisState = computed<FieldState>(() => {
  if (!chassisNumber.value) return 'idle'
  return isCompleteChassisNumber(chassisNumber.value) ? 'ok' : 'error'
})
const chassisDetail = computed(() =>
  chassisState.value === 'error' ? 'A chassis number is four letters then six digits.' : '',
)
const chassisOk = computed(() => {
  if (kind.value === 'BARE_CHASSIS') return isCompleteChassisNumber(chassisNumber.value)
  return !chassisNumber.value || isCompleteChassisNumber(chassisNumber.value)
})

function resolveNumber(number: string) {
  return $fetch('/api/containers/resolve', { query: { number } })
}
type Resolution = Awaited<ReturnType<typeof resolveNumber>>
const resolution = ref<Resolution | null>(null)
const resolving = ref(false)

const needsClassification = computed(() =>
  kind.value === 'CONTAINER' && resolution.value?.outcome === 'CREATE',
)

const STEPS = computed<Step[]>(() => {
  const steps: Step[] = ['kind', 'equipment']
  if (needsClassification.value) steps.push('containerType', 'equipmentType')
  steps.push('confirm')
  return steps
})

const step = ref<Step>('kind')
watch(step, scrollWizardToTop)
const stepIndex = computed(() => Math.max(0, STEPS.value.indexOf(step.value)))
const navTitle = computed(() => {
  if (step.value === 'equipment') {
    return kind.value === 'BARE_CHASSIS' ? 'Chassis' : 'Container and chassis'
  }
  return STEP_TITLES[step.value]
})

watch(STEPS, (steps) => {
  if (steps.includes(step.value)) return
  step.value = steps[Math.min(stepIndex.value, steps.length - 1)] ?? 'kind'
})

watch(kind, () => {
  if (kind.value !== 'CONTAINER') resolution.value = null
})

function isHeldByDriver(current: Resolution | null | undefined) {
  if (!current) return false
  if (current.holder) return true
  return containerHasDriverClaim(current.container) || containerIsHeldByDriver(current.container?.activePoolState)
}

let releasePrompt: Promise<Resolution | null> | null = null

async function offerDriverRelease(current: Resolution | null) {
  if (releasePrompt) return releasePrompt
  releasePrompt = (async () => {
    const containerId = current?.container?.id
    if (!containerId || !isHeldByDriver(current)) return current
    const released = await releaseDriverIfNeeded({
      containerId,
      driverName: current.holder?.driverName,
      containerNumber: current.container?.number ?? normalized.value,
    })
    if (!released) return current
    const next = await resolveNumber(normalized.value)
    resolution.value = next
    return next
  })().finally(() => {
    releasePrompt = null
  })
  return releasePrompt
}

watch(normalized, async (value) => {
  if (kind.value !== 'CONTAINER') return
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

watch(step, (current) => {
  if (current === 'confirm' && isHeldByDriver(resolution.value)) {
    void offerDriverRelease(resolution.value)
  }
})

const canAdvance = computed(() => {
  switch (step.value) {
    case 'kind':
      return kind.value === 'CONTAINER' || kind.value === 'BARE_CHASSIS'
    case 'equipment':
      if (kind.value === 'BARE_CHASSIS') {
        return chassisOk.value && !readingPhoto.value
      }
      return validation.value.structureValid
        && chassisOk.value
        && isLoaded.value !== null
        && !resolving.value
        && Boolean(resolution.value)
        && !readingPhoto.value
    case 'containerType':
      return Boolean(containerType.value)
    case 'equipmentType':
      return Boolean(equipmentType.value)
    case 'confirm':
      if (kind.value === 'BARE_CHASSIS') return true
      return Boolean(containerType.value) && Boolean(equipmentType.value) && isLoaded.value !== null
  }
  return false
})

function chooseKind(nextKind: TripKind) {
  if (kind.value !== nextKind) {
    containerType.value = null
    equipmentType.value = null
    isLoaded.value = null
  }
  kind.value = nextKind
  void next()
}

async function next() {
  errorMessage.value = ''
  const index = stepIndex.value
  if (index < STEPS.value.length - 1) step.value = STEPS.value[index + 1]!
}

function back() {
  const index = stepIndex.value
  if (index > 0) step.value = STEPS.value[index - 1]!
}

function pickContainerType(type: ContainerType) {
  containerType.value = type
  next()
}

function pickEquipmentType(type: EquipmentType) {
  equipmentType.value = type
  next()
}

const showNext = computed(() => {
  if (step.value === 'kind' || step.value === 'containerType' || step.value === 'equipmentType') return false
  return true
})

async function confirm() {
  if (submitting.value || driverReleasing.value) return
  errorMessage.value = ''
  if (isHeldByDriver(resolution.value)) {
    const next = await offerDriverRelease(resolution.value)
    if (isHeldByDriver(next)) return
  }
  if (chassisNumber.value.trim()) {
    try {
      const found = await $fetch('/api/chassis', {
        method: 'POST',
        body: { number: chassisNumber.value },
      })
      const keepId = kind.value === 'CONTAINER' ? (resolution.value?.container?.id ?? null) : null
      if (!await releaseIfNeeded(found.item, keepId)) return
    }
    catch (error) {
      errorMessage.value = apiErrorMessage(error, 'Could not check the chassis.')
      return
    }
  }
  submitting.value = true
  try {
    if (kind.value !== 'BARE_CHASSIS' && (!containerType.value || !equipmentType.value || isLoaded.value === null)) {
      errorMessage.value = 'Choose container type, size, and empty or load.'
      return
    }
    const { withLoader } = useBrandLoader()
    await withLoader(async () => {
      if (kind.value === 'BARE_CHASSIS') {
        await $fetch(`/api/locations/${locationId.value}/chassis`, {
          method: 'POST',
          body: {
            eventId: crypto.randomUUID(),
            chassisNumber: chassisNumber.value,
          },
        })
      }
      else {
        await $fetch(`/api/locations/${locationId.value}/containers`, {
          method: 'POST',
          body: {
            eventId: crypto.randomUUID(),
            containerNumber: normalized.value,
            containerType: containerType.value,
            equipmentType: equipmentType.value,
            isLoaded: isLoaded.value,
            chassisNumber: chassisNumber.value || null,
          },
        })
      }
      await navigateTo(`/locations/${locationId.value}`)
    })
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not add the equipment.')
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
    if (kind.value === 'BARE_CHASSIS') {
      if (result.chassis) chassisNumber.value = maskChassisInput(result.chassis)
      if (!result.chassis) {
        ocrMessage.value = result.message || 'No chassis number could be read. Edit the field or retake.'
      }
    }
    else {
      if (result.container) rawNumber.value = maskContainerInput(result.container)
      if (result.chassis) chassisNumber.value = maskChassisInput(result.chassis)
      if (!result.container) {
        ocrMessage.value = result.message || 'No container number could be read. Edit the field or retake.'
      }
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
      :title="navTitle"
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

    <template v-if="step === 'kind'">
      <span class="wiz-label">Add Equipment</span>
      <div class="wiz-group">
        <button
          type="button"
          class="wiz-pick"
          :aria-pressed="kind === 'CONTAINER'"
          @click="chooseKind('CONTAINER')"
        >
          <span class="wiz-pick-ico">
            <EquipmentIcon name="container" />
          </span>
          <span class="wiz-pick-main">
            <b>{{ TRIP_KIND_LABELS.CONTAINER }}</b>
            <small>Box and chassis</small>
          </span>
          <span
            class="wiz-chev"
            aria-hidden="true"
          >›</span>
        </button>
        <button
          type="button"
          class="wiz-pick"
          :aria-pressed="kind === 'BARE_CHASSIS'"
          @click="chooseKind('BARE_CHASSIS')"
        >
          <span class="wiz-pick-ico">
            <EquipmentIcon name="chassis" />
          </span>
          <span class="wiz-pick-main">
            <b>{{ TRIP_KIND_LABELS.BARE_CHASSIS }}</b>
            <small>Chassis only</small>
          </span>
          <span
            class="wiz-chev"
            aria-hidden="true"
          >›</span>
        </button>
      </div>
    </template>

    <template v-else-if="step === 'equipment'">
      <ScanReadingLoader
        v-if="readingPhoto"
        :label="kind === 'BARE_CHASSIS' ? 'Reading the chassis number…' : 'Reading the photo…'"
      />
      <template v-else>
        <ScanPhotoPeek
          v-if="capturedPhoto"
          :src="capturedPhoto"
        />
        <div class="wiz-hero">
          <span class="wiz-hero-badge">
            <EquipmentIcon
              :name="kind === 'BARE_CHASSIS' ? 'chassis' : 'container'"
              :size="60"
            />
          </span>
          <b>{{ kind ? TRIP_KIND_LABELS[kind] : '' }}</b>
        </div>

        <template v-if="kind === 'CONTAINER'">
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
        </template>

        <span class="wiz-label">Chassis info</span>
        <div class="wiz-group">
          <div class="wiz-row">
            <label
              class="wiz-row-label"
              for="add-chassis-number"
            >Number</label>
            <ChassisNumberInput
              id="add-chassis-number"
              v-model="chassisNumber"
              :invalid="chassisState === 'error'"
            />
            <FieldStatus
              :state="chassisState"
              :detail="chassisDetail || 'Four letters and six digits.'"
              label="chassis number"
            />
          </div>
        </div>
        <p
          v-if="kind === 'CONTAINER'"
          class="wiz-hint"
        >
          Leave the chassis blank if the box is sitting without one.
        </p>

        <div
          v-if="kind === 'CONTAINER'"
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
          v-if="kind === 'CONTAINER' && resolving"
          class="banner info mt-4"
          role="status"
        >
          <span aria-hidden="true">▸</span>
          <span>Checking the active pool…</span>
        </p>
        <p
          v-else-if="kind === 'CONTAINER' && resolution && !isHeldByDriver(resolution)"
          class="banner info mt-4"
          role="status"
        >
          <span aria-hidden="true">▸</span>
          <span>{{ resolution.message }}</span>
        </p>
        <DevicePhotoInput
          class="btn-ghost mt-4 w-full"
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

    <template v-else>
      <span class="wiz-label">On site</span>
      <div class="wiz-group">
        <div
          v-if="kind === 'CONTAINER'"
          class="wiz-row"
        >
          <span class="wiz-row-label">Number</span>
          <span class="mono flex-1">{{ formatContainerNumber(normalized) }}</span>
        </div>
        <div
          v-if="kind === 'CONTAINER'"
          class="wiz-row"
        >
          <span class="wiz-row-label">Box</span>
          <span class="flex-1 text-[var(--color-ink-700)]">
            {{ containerType ? CONTAINER_TYPE_LABELS[containerType] : '—' }}
            · {{ equipmentType ? pickupEquipmentSizeLabel(equipmentType) : '—' }}
            · {{ isLoaded === true ? 'Loaded' : 'Empty' }}
          </span>
        </div>
        <div
          v-if="chassisNumber"
          class="wiz-row"
        >
          <span class="wiz-row-label">Chassis</span>
          <span class="mono flex-1">{{ formatChassisNumber(chassisNumber) }}</span>
        </div>
        <div class="wiz-row">
          <span class="wiz-row-label">Where</span>
          <span class="flex-1 text-[var(--color-ink-700)]">{{ locationData?.location.name }}</span>
        </div>
      </div>
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
        @click="confirm"
      >
        {{ submitting ? 'Saving…' : 'Save equipment' }}
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

    <ChassisReleaseSheet
      :open="Boolean(chassisConflict)"
      :message="chassisConflictText"
      :busy="chassisReleasing"
      @close="decideChassisRelease(false)"
      @confirm="decideChassisRelease(true)"
    />
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
