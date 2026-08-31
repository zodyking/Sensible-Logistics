<script setup lang="ts">
import { isCompleteChassisNumber, maskChassisInput, maskContainerInput, validateContainerNumber } from '#shared/utils/iso6346'
import { driverOcrMessage } from '#shared/utils/ocr-parse'

useHead({ title: 'Scan' })

const reading = ref(false)
const captured = ref(false)
const capturedPhoto = ref('')
const errorMessage = ref('')
const containerNumber = ref('')
const chassisNumber = ref('')

const containerValidation = computed(() => validateContainerNumber(containerNumber.value))
const chassisOk = computed(() => !chassisNumber.value || isCompleteChassisNumber(chassisNumber.value))
const canContinue = computed(() =>
  containerValidation.value.structureValid
  && chassisOk.value
  && !reading.value,
)

type FieldState = 'ok' | 'error' | 'idle'

const containerState = computed<FieldState>(() => {
  if (containerNumber.value.length < 11) return 'idle'
  return containerValidation.value.valid ? 'ok' : 'error'
})

const containerDetail = computed(() => {
  if (containerState.value === 'idle') return ''
  const parts: string[] = []
  if (!containerValidation.value.valid) {
    parts.push(containerValidation.value.errors[0] ?? 'This is not a valid ISO 6346 number.')
    if (containerValidation.value.structureValid && containerValidation.value.expectedCheckDigit !== null) {
      parts.push(`The boxed digit should be ${containerValidation.value.expectedCheckDigit}.`)
    }
  }
  parts.push(...containerValidation.value.warnings)
  return parts.join(' ')
})

const chassisState = computed<FieldState>(() => {
  if (!chassisNumber.value) return 'idle'
  return isCompleteChassisNumber(chassisNumber.value) ? 'ok' : 'error'
})

const chassisDetail = computed(() =>
  chassisState.value === 'error' ? 'A chassis number is four letters then six digits.' : '',
)

async function onPhoto(dataUrl: string) {
  captured.value = true
  capturedPhoto.value = dataUrl
  reading.value = true
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
    if (result.container) containerNumber.value = maskContainerInput(result.container)
    if (result.chassis) chassisNumber.value = maskChassisInput(result.chassis)
    if (!result.container) {
      errorMessage.value = result.message || 'No container number could be read. Edit the fields or retake.'
    }
  }
  catch (error) {
    errorMessage.value = driverOcrMessage(
      apiErrorMessage(error, 'Could not read the photo. Edit the fields or retake.'),
      'Could not read the photo. Edit the fields or retake.',
    )
  }
  finally {
    await waitAtLeast(startedAt, PHOTO_READ_MIN_MS)
    reading.value = false
  }
}

async function continuePickup() {
  if (!canContinue.value) return
  await navigateTo({
    path: '/pickups/new',
    query: {
      number: containerNumber.value,
      chassis: chassisNumber.value || undefined,
    },
  })
}
</script>

<template>
  <section class="d-page">
    <PageHeader
      eyebrow="Capture"
      title="Container and chassis"
      back-to="/"
      back-label="Home"
    />

    <ScanReadingLoader
      v-if="reading"
      label="Reading the photo…"
    />

    <ScanPhotoPeek
      v-if="capturedPhoto && !reading"
      :src="capturedPhoto"
    />

    <div
      v-if="captured && !reading"
      class="card p-4"
    >
      <label
        class="field"
        for="scan-container"
      >
        <span>Container number</span>
        <div class="field-row">
          <ContainerNumberInput
            id="scan-container"
            v-model="containerNumber"
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
        class="field !mb-0 mt-5"
        for="scan-chassis"
      >
        <span>Chassis number</span>
        <div class="field-row">
          <ChassisNumberInput
            id="scan-chassis"
            v-model="chassisNumber"
            :invalid="chassisState === 'error'"
          />
          <FieldStatus
            :state="chassisState"
            :detail="chassisDetail"
            label="chassis number"
          />
        </div>
        <small class="field-hint">Four letters and six digits. Leave blank if there is no chassis.</small>
      </label>
    </div>

    <div aria-live="polite">
      <p
        v-if="errorMessage && !reading"
        class="note warn"
      >
        <span>{{ errorMessage }}</span>
      </p>
    </div>

    <p
      v-if="!captured"
      class="text-sm text-[var(--color-ink-500)]"
    >
      Point the camera at the container number and the chassis plate, then take one photo.
    </p>

    <div
      v-if="!reading"
      class="mt-6 flex gap-3"
    >
      <DevicePhotoInput
        class="btn-ghost flex-1"
        :label="captured ? 'Retake photo' : 'Take photo'"
        :disabled="reading"
        @photo="onPhoto"
      />
      <button
        type="button"
        class="btn-dark flex-1"
        :disabled="!canContinue"
        @click="continuePickup"
      >
        Continue
      </button>
    </div>
  </section>
</template>
