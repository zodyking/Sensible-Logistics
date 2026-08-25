<script setup lang="ts">
import { formatContainerNumber, hasIsoEquipmentCategory, normalizeContainerNumber, validateContainerNumber } from '#shared/utils/iso6346'

useHead({ title: 'Scan' })

type ScanProfile = 'container' | 'chassis'

const profile = ref<ScanProfile>('container')

const videoEl = ref<HTMLVideoElement | null>(null)
const guideEl = ref<HTMLElement | null>(null)
const cameraState = ref<'idle' | 'starting' | 'live' | 'denied' | 'unsupported'>('idle')
const cameraMessage = ref('')
let stream: MediaStream | null = null

async function startCamera() {
  if (!import.meta.client || !navigator.mediaDevices?.getUserMedia) {
    cameraState.value = 'unsupported'
    cameraMessage.value = 'This device or browser does not expose a camera to the web app.'
    return
  }

  cameraState.value = 'starting'
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    })
    if (videoEl.value) {
      videoEl.value.srcObject = stream
      await videoEl.value.play()
    }
    cameraState.value = 'live'
  }
  catch {
    cameraState.value = 'denied'
    cameraMessage.value = 'Camera access was blocked. Enter the number by hand instead.'
  }
}

function stopCamera() {
  stream?.getTracks().forEach(track => track.stop())
  stream = null
  cameraState.value = 'idle'
}

onBeforeUnmount(stopCamera)

/**
 * Map the on-screen guide rectangle back onto the camera buffer, accounting
 * for `object-cover` centering. Container markings are stacked top-to-bottom,
 * so that crop is rotated 90° CCW into a left-to-right line before OCR.
 */
function captureGuide(): string {
  const video = videoEl.value
  const guide = guideEl.value
  if (!video || !guide || video.videoWidth < 2 || video.videoHeight < 2) {
    throw new Error('Camera is not ready.')
  }

  const vRect = video.getBoundingClientRect()
  const gRect = guide.getBoundingClientRect()
  const scale = Math.max(vRect.width / video.videoWidth, vRect.height / video.videoHeight)
  const displayedW = video.videoWidth * scale
  const displayedH = video.videoHeight * scale
  const originX = vRect.left - (displayedW - vRect.width) / 2
  const originY = vRect.top - (displayedH - vRect.height) / 2

  let sx = (gRect.left - originX) / scale
  let sy = (gRect.top - originY) / scale
  let sw = gRect.width / scale
  let sh = gRect.height / scale

  sx = Math.max(0, Math.min(video.videoWidth - 1, sx))
  sy = Math.max(0, Math.min(video.videoHeight - 1, sy))
  sw = Math.max(8, Math.min(video.videoWidth - sx, sw))
  sh = Math.max(8, Math.min(video.videoHeight - sy, sh))

  const rotate = profile.value === 'container'
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not capture a frame.')

  if (rotate) {
    canvas.width = Math.round(sh)
    canvas.height = Math.round(sw)
    ctx.translate(0, canvas.height)
    ctx.rotate(-Math.PI / 2)
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh)
  }
  else {
    canvas.width = Math.round(sw)
    canvas.height = Math.round(sh)
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh)
  }

  contrastStretch(canvas)

  // Upscale tiny crops so Tesseract has enough pixels for a stencil.
  const minWidth = 480
  if (canvas.width < minWidth) {
    const factor = minWidth / canvas.width
    const scaled = document.createElement('canvas')
    scaled.width = minWidth
    scaled.height = Math.round(canvas.height * factor)
    const scaledCtx = scaled.getContext('2d')
    if (scaledCtx) {
      scaledCtx.imageSmoothingEnabled = false
      scaledCtx.drawImage(canvas, 0, 0, scaled.width, scaled.height)
      return scaled.toDataURL('image/jpeg', 0.92)
    }
  }

  return canvas.toDataURL('image/jpeg', 0.92)
}

function contrastStretch(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = image.data
  let min = 255
  let max = 0
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!
    if (y < min) min = y
    if (y > max) max = y
  }
  const span = Math.max(1, max - min)
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!
    const stretched = Math.round(((y - min) / span) * 255)
    data[i] = stretched
    data[i + 1] = stretched
    data[i + 2] = stretched
  }
  ctx.putImageData(image, 0, 0)
}

const recognizing = ref(false)
const ocrError = ref('')
const ocrHint = ref('')
const candidates = ref<Array<{ value: string, confidence: number, band: string, checkDigitValid: boolean }>>([])

async function recognize() {
  if (recognizing.value) return
  recognizing.value = true
  ocrError.value = ''
  ocrHint.value = ''
  candidates.value = []

  try {
    if (cameraState.value !== 'live') {
      throw new Error('Start the camera, frame the number, then tap Read number.')
    }

    const image = captureGuide()
    const result = await $fetch('/api/scan/recognize', {
      method: 'POST',
      body: { profile: profile.value, image },
    })

    candidates.value = result.candidates.map(c => ({
      value: c.value,
      confidence: c.confidence,
      band: c.band,
      checkDigitValid: c.checkDigitValid,
    }))

    if (result.available === false) {
      ocrError.value = result.message || 'The number could not be read.'
    }
    else if (!candidates.value.length) {
      ocrHint.value = result.message || (profile.value === 'container'
        ? 'No container number in the frame. Fill the tall box with the stacked letters and digits, then read again.'
        : 'No chassis plate in the frame. Fill the wide box and read again.')
    }
    else {
      const best = candidates.value.find(c => c.checkDigitValid) ?? (profile.value === 'chassis' ? candidates.value[0] : null)
      if (best) applyCandidate(best.value)
      else ocrHint.value = 'Nothing in the frame passed an ISO check digit. Re-frame the stacked number, or type it below.'
    }
  }
  catch (error) {
    ocrError.value = apiErrorMessage(error, 'Recognition failed. Use manual entry.')
  }
  finally {
    recognizing.value = false
  }
}

function applyCandidate(value: string) {
  manual.value = value
}

watch(profile, () => {
  candidates.value = []
  ocrError.value = ''
  ocrHint.value = ''
  lookupState.value = 'idle'
})

/* --- Manual entry, always available ------------------------------ */
const manual = ref('')
const normalized = computed(() => normalizeContainerNumber(manual.value))
const validation = computed(() => validateContainerNumber(manual.value))
const showContainerValidation = computed(() => profile.value === 'container' && normalized.value.length >= 11)
const containerReady = computed(() => profile.value === 'container' && hasIsoEquipmentCategory(normalized.value))
const chassisReady = computed(() => profile.value === 'chassis' && normalized.value.length >= 4 && /\d/.test(normalized.value))

const lookupState = ref<'idle' | 'searching' | 'missing'>('idle')

async function lookup() {
  lookupState.value = 'searching'

  try {
    if (profile.value === 'chassis') {
      const result = await $fetch('/api/chassis', { query: { q: normalized.value, limit: 1 } })
      const match = result.items[0]
      if (match) {
        await navigateTo({ path: '/pickups/new', query: { chassis: match.number } })
        return
      }
      lookupState.value = 'missing'
      return
    }

    const result = await $fetch('/api/containers', { query: { q: normalized.value, scope: 'all', limit: 1 } })
    const match = result.items[0]
    if (match) {
      await navigateTo(`/containers/${match.id}`)
      return
    }
    lookupState.value = 'missing'
  }
  catch {
    lookupState.value = 'missing'
  }
}

const pickupQuery = computed(() =>
  profile.value === 'chassis'
    ? { chassis: normalized.value }
    : { number: normalized.value },
)
</script>

<template>
  <section class="d-page">
    <PageHeader
      eyebrow="Capture"
      :title="profile === 'chassis' ? 'Scan a chassis' : 'Scan a container'"
    />

    <fieldset class="scan-target">
      <legend class="sr-only">
        What are you scanning?
      </legend>
      <button
        type="button"
        :aria-pressed="profile === 'container'"
        @click="profile = 'container'"
      >
        <b>Container</b>
        <small>Vertical number</small>
      </button>
      <button
        type="button"
        :aria-pressed="profile === 'chassis'"
        @click="profile = 'chassis'"
      >
        <b>Chassis</b>
        <small>Horizontal plate</small>
      </button>
    </fieldset>

    <!-- ── Camera ──────────────────────────────────────────────── -->
    <div class="card overflow-hidden">
      <div class="relative aspect-[3/4] bg-[var(--color-navy-950)] sm:aspect-[4/3]">
        <video
          ref="videoEl"
          class="size-full object-cover"
          playsinline
          muted
        />

        <div
          ref="guideEl"
          class="scan-guide"
          :class="profile === 'container' ? 'vertical' : 'horizontal'"
          aria-hidden="true"
        >
          <span class="scan-guide-label">
            {{ profile === 'container' ? 'Frame the vertical number' : 'Frame the chassis plate' }}
          </span>
        </div>

        <div
          v-if="cameraState !== 'live'"
          class="absolute inset-0 grid place-items-center p-6 text-center"
        >
          <div>
            <span
              class="mb-3 block text-3xl text-white/30"
              aria-hidden="true"
            >⊙</span>
            <p class="text-sm text-white/70">
              {{ cameraMessage || (profile === 'container'
                ? 'Start the camera and stand the phone so the stacked container number fills the tall frame.'
                : 'Start the camera and fill the wide frame with the chassis plate.') }}
            </p>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3 p-4">
        <button
          v-if="cameraState !== 'live'"
          class="btn-dark"
          :disabled="cameraState === 'starting'"
          @click="startCamera"
        >
          {{ cameraState === 'starting' ? 'Starting…' : 'Start camera' }}
        </button>
        <button
          v-else
          class="btn-ghost"
          @click="stopCamera"
        >
          Stop camera
        </button>

        <button
          class="btn-primary-action !min-h-12 !text-base"
          :disabled="recognizing"
          @click="recognize"
        >
          {{ recognizing ? 'Reading…' : 'Read number' }}
        </button>
      </div>
    </div>

    <p
      v-if="ocrError"
      class="banner warn mt-4"
      role="status"
    >
      <span aria-hidden="true">!</span>
      <span>{{ ocrError }}</span>
    </p>

    <p
      v-else-if="ocrHint"
      class="banner info mt-4"
      role="status"
    >
      <span aria-hidden="true">▸</span>
      <span>{{ ocrHint }}</span>
    </p>

    <div
      v-if="candidates.length"
      class="card mt-4"
    >
      <div class="section-label !mt-0 px-4 pt-4">
        <span>Candidates</span>
      </div>
      <div class="rowlist">
        <button
          v-for="candidate in candidates"
          :key="candidate.value"
          type="button"
          class="row"
          @click="applyCandidate(candidate.value)"
        >
          <span class="row-main">
            <b class="mono">{{ profile === 'container' ? formatContainerNumber(candidate.value) : candidate.value }}</b>
            <small>
              {{ candidate.band }} confidence · {{ Math.round(candidate.confidence * 100) }}%
              <template v-if="profile === 'container'">
                · {{ candidate.checkDigitValid ? 'check digit ok' : 'check digit failed' }}
              </template>
            </small>
          </span>
          <span
            class="row-end"
            aria-hidden="true"
          >›</span>
        </button>
      </div>
    </div>

    <!-- ── Manual entry, the always-available fast path ────────── -->
    <div class="section-label">
      <span>Manual entry</span>
    </div>

    <div class="card p-4">
      <label class="field">
        <span>{{ profile === 'chassis' ? 'Chassis number' : 'Container number' }}</span>
        <input
          v-model="manual"
          class="input mono"
          :class="{ invalid: showContainerValidation && !validation.structureValid }"
          :placeholder="profile === 'chassis' ? 'ABCZ1234567' : 'MSCU4521894'"
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          maxlength="17"
          aria-describedby="scan-validation"
        >
      </label>

      <div
        id="scan-validation"
        aria-live="polite"
      >
        <p
          v-if="showContainerValidation && validation.valid"
          class="banner ok mb-3"
        >
          <span aria-hidden="true">✓</span>
          <span><b>{{ formatContainerNumber(normalized) }}</b> Check digit is valid.</span>
        </p>
        <p
          v-else-if="showContainerValidation"
          class="banner warn mb-3"
        >
          <span aria-hidden="true">!</span>
          <span>{{ validation.errors[0] }}</span>
        </p>
      </div>

      <button
        class="btn-dark"
        :disabled="profile === 'container'
          ? !containerReady || lookupState === 'searching'
          : !chassisReady || lookupState === 'searching'"
        @click="lookup"
      >
        {{ lookupState === 'searching'
          ? 'Looking up…'
          : profile === 'chassis' ? 'Open chassis on pickup' : 'Open container record' }}
      </button>

      <p
        v-if="lookupState === 'missing'"
        class="banner info mt-3 mb-0"
      >
        <span aria-hidden="true">▸</span>
        <span>
          Not in this company's registry yet. Start a pickup to create the record.
        </span>
      </p>
    </div>

    <NuxtLink
      :to="{ path: '/pickups/new', query: pickupQuery }"
      class="btn-primary-action mt-4"
      :class="{ 'pointer-events-none opacity-40': profile === 'container' ? !containerReady : !chassisReady }"
    >
      Start a pickup with this number
    </NuxtLink>

    <p class="mt-6 text-xs text-[var(--color-ink-500)]">
      Photos stay on this server. Recognition runs with Tesseract inside the app container —
      nothing is sent to a third-party OCR API. Confirm every reading before it becomes a
      custody event.
    </p>
  </section>
</template>
