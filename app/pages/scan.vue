<script setup lang="ts">
import { formatContainerNumber, isCompleteChassisNumber, maskChassisInput, maskContainerInput, validateContainerNumber } from '#shared/utils/iso6346'

useHead({ title: 'Scan' })

const cameraOpen = ref(true)
const reading = ref(false)
const captured = ref(false)
const errorMessage = ref('')
const containerNumber = ref('')
const chassisNumber = ref('')

const containerValidation = computed(() => validateContainerNumber(containerNumber.value))
const chassisOk = computed(() => !chassisNumber.value || isCompleteChassisNumber(chassisNumber.value))
const canContinue = computed(() =>
  containerValidation.value.structureValid && chassisOk.value && !reading.value,
)

async function onPhoto(dataUrl: string) {
  cameraOpen.value = false
  captured.value = true
  reading.value = true
  errorMessage.value = ''
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
    errorMessage.value = apiErrorMessage(error, 'Could not read the photo. Edit the fields or retake.')
  }
  finally {
    reading.value = false
  }
}

function retake() {
  errorMessage.value = ''
  cameraOpen.value = true
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

    <p
      v-if="reading"
      class="banner info"
      role="status"
    >
      <span aria-hidden="true">▸</span>
      <span>Reading the photo…</span>
    </p>

    <p
      v-else-if="errorMessage"
      class="banner warn"
      role="status"
    >
      <span aria-hidden="true">!</span>
      <span>{{ errorMessage }}</span>
    </p>

    <div
      v-if="captured"
      class="card p-4"
    >
      <label class="field">
        <span>Container number</span>
        <ContainerNumberInput
          v-model="containerNumber"
          :invalid="containerNumber.length >= 11 && !containerValidation.structureValid"
        />
        <small class="field-hint">Four letters, six digits, dash, then the boxed check digit.</small>
      </label>

      <p
        v-if="containerValidation.structureValid"
        class="banner mt-3 mb-4"
        :class="containerValidation.valid ? 'ok' : 'warn'"
      >
        <span aria-hidden="true">{{ containerValidation.valid ? '✓' : '!' }}</span>
        <span>
          <b>{{ formatContainerNumber(containerNumber) }}</b>
          {{ containerValidation.valid ? 'ISO 6346 check digit is valid.' : containerValidation.errors[0] }}
        </span>
      </p>

      <label class="field !mb-0">
        <span>Trailer / chassis number</span>
        <ChassisNumberInput
          v-model="chassisNumber"
          :invalid="Boolean(chassisNumber) && !chassisOk"
        />
        <small class="field-hint">Four letters and six digits. Leave blank if there is no chassis.</small>
      </label>
    </div>

    <p
      v-else
      class="text-sm text-[var(--color-ink-500)]"
    >
      Point the camera at the container number and the chassis plate, then take one photo.
    </p>

    <div class="mt-6 flex gap-3">
      <button
        type="button"
        class="btn-ghost flex-1"
        :disabled="reading"
        @click="retake"
      >
        {{ captured ? 'Retake photo' : 'Open camera' }}
      </button>
      <button
        type="button"
        class="btn-dark flex-1"
        :disabled="!canContinue"
        @click="continuePickup"
      >
        Continue
      </button>
    </div>

    <CaptureCamera
      v-if="cameraOpen"
      title="Container and chassis"
      @close="cameraOpen = false"
      @photo="onPhoto"
    />
  </section>
</template>
