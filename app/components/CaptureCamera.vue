<script setup lang="ts">
import { formatContainerNumber } from '#shared/utils/iso6346'

const props = withDefaults(defineProps<{
  profile: 'container' | 'chassis'
  title?: string
}>(), {
  title: '',
})

const emit = defineEmits<{
  close: []
  captured: [value: string]
}>()

const heading = computed(() =>
  props.title || (props.profile === 'chassis' ? 'Chassis number' : 'Container number'),
)

type CameraState = 'starting' | 'live' | 'denied' | 'unsupported'
type Phase = 'camera' | 'reading' | 'review'

const videoEl = ref<HTMLVideoElement | null>(null)
const libraryInput = ref<HTMLInputElement | null>(null)
const cameraState = ref<CameraState>('starting')
const cameraMessage = ref('')
const phase = ref<Phase>('camera')
const previewUrl = ref('')
const recognizing = ref(false)
const ocrError = ref('')
const candidates = ref<Array<{ value: string, confidence: number, band: string, checkDigitValid: boolean }>>([])
const selected = ref('')

let stream: MediaStream | null = null

function stopCamera() {
  stream?.getTracks().forEach(track => track.stop())
  stream = null
}

async function startCamera() {
  if (!import.meta.client || !navigator.mediaDevices?.getUserMedia) {
    cameraState.value = 'unsupported'
    cameraMessage.value = 'This device cannot open the camera. Use a photo from the library instead.'
    return
  }

  cameraState.value = 'starting'
  cameraMessage.value = ''
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
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
    cameraMessage.value = 'Camera access was blocked. Use a photo from the library instead.'
  }
}

onMounted(() => {
  document.documentElement.classList.add('capture-open')
  startCamera()
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('capture-open')
  stopCamera()
})

function frameToDataUrl(source: CanvasImageSource, width: number, height: number): string {
  const maxEdge = 1280
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not capture the photo.')
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.82)
}

function captureShutter(): string {
  const video = videoEl.value
  if (!video || video.videoWidth < 2 || video.videoHeight < 2) {
    throw new Error('Camera is not ready.')
  }
  return frameToDataUrl(video, video.videoWidth, video.videoHeight)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read the photo.'))
    img.src = src
  })
}

/** 90° clockwise turns so stacked container numbers become a horizontal line. */
async function rotateDataUrl(dataUrl: string, quarterTurns: number): Promise<string> {
  const turns = ((quarterTurns % 4) + 4) % 4
  const img = await loadImage(dataUrl)
  if (turns === 0) return dataUrl
  const swap = turns % 2 === 1
  const canvas = document.createElement('canvas')
  canvas.width = swap ? img.naturalHeight : img.naturalWidth
  canvas.height = swap ? img.naturalWidth : img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not rotate the photo.')
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate(turns * Math.PI / 2)
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
  return frameToDataUrl(canvas, canvas.width, canvas.height)
}

async function framesForOcr(image: string): Promise<string[]> {
  if (props.profile !== 'container') return [image]
  const rotated90 = await rotateDataUrl(image, 3) // 270° = 90° CCW (door numbers read down)
  const rotated270 = await rotateDataUrl(image, 1)
  return [rotated90, image, rotated270]
}

async function normalizeToJpeg(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl)
  return frameToDataUrl(img, img.naturalWidth, img.naturalHeight)
}

const rawText = ref('')
const engineLabel = ref('')

async function recognizeImage(image: string) {
  recognizing.value = true
  phase.value = 'reading'
  ocrError.value = ''
  candidates.value = []
  selected.value = ''
  rawText.value = ''
  engineLabel.value = ''
  previewUrl.value = image

  try {
    const jpeg = await normalizeToJpeg(image)
    previewUrl.value = jpeg
    const frames = await framesForOcr(jpeg)
    const result = await $fetch('/api/scan/recognize', {
      method: 'POST',
      timeout: 120_000,
      headers: { 'Cache-Control': 'no-store' },
      body: { profile: props.profile, image: frames[0], images: frames },
    })

    candidates.value = result.candidates.map(c => ({
      value: c.value,
      confidence: c.confidence,
      band: c.band,
      checkDigitValid: c.checkDigitValid,
    }))
    selected.value = candidates.value[0]?.value ?? ''
    rawText.value = result.rawText || ''
    engineLabel.value = [result.engine, result.engineVersion].filter(Boolean).join(' ')

    if (result.available === false) {
      ocrError.value = result.message || 'The number could not be read.'
    }
    else if (!candidates.value.length) {
      ocrError.value = result.message || 'No number found. Take another photo, or type it on the previous screen.'
    }
  }
  catch (error) {
    ocrError.value = apiErrorMessage(error, 'Could not read the photo.')
  }
  finally {
    recognizing.value = false
    phase.value = 'review'
  }
}

async function takePhoto() {
  if (recognizing.value) return
  try {
    const image = captureShutter()
    stopCamera()
    await recognizeImage(image)
  }
  catch (error) {
    ocrError.value = error instanceof Error ? error.message : 'Could not take the photo.'
    phase.value = 'review'
  }
}

function openLibrary() {
  libraryInput.value?.click()
}

async function onLibrary(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  const dataUrl = await new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('Could not open that photo.'))
    reader.readAsDataURL(file)
  })
  stopCamera()
  await recognizeImage(dataUrl)
  if (libraryInput.value) libraryInput.value.value = ''
}

async function retake() {
  previewUrl.value = ''
  candidates.value = []
  selected.value = ''
  ocrError.value = ''
  rawText.value = ''
  engineLabel.value = ''
  phase.value = 'camera'
  await startCamera()
}

function useSelected() {
  if (!selected.value) return
  emit('captured', selected.value)
}

function formatValue(value: string) {
  return props.profile === 'container' ? formatContainerNumber(value) : value
}

const extras = computed(() => candidates.value.filter(c => c.value !== selected.value).slice(0, 4))
</script>

<template>
  <Teleport to="body">
    <div
      class="capture-overlay"
      role="dialog"
      aria-modal="true"
      :aria-label="heading"
    >
      <div class="capture-bar">
        <button
          type="button"
          class="capture-iconbtn"
          aria-label="Close camera"
          @click="emit('close')"
        >
          ✕
        </button>
        <b>{{ heading }}</b>
        <span aria-hidden="true" />
      </div>

      <div class="capture-stage">
        <video
          v-show="phase === 'camera'"
          ref="videoEl"
          playsinline
          muted
          autoplay
        />
        <img
          v-if="phase !== 'camera' && previewUrl"
          :src="previewUrl"
          alt="Captured photo"
        >
        <div
          v-if="phase === 'camera' && cameraState !== 'live'"
          class="capture-stage-msg"
        >
          <p>{{ cameraMessage || 'Starting camera…' }}</p>
        </div>
        <div
          v-else-if="phase === 'reading'"
          class="capture-stage-msg"
        >
          <p>Reading the number…</p>
        </div>
        <div
          v-else-if="phase === 'review' && selected"
          class="capture-readout"
        >
          <span class="mono">{{ formatValue(selected) }}</span>
          <small>
            Confirm this reading, or pick another candidate.
          </small>
          <small
            v-if="rawText"
            class="capture-raw"
          >OCR: {{ rawText }}</small>
          <small
            v-if="engineLabel"
            class="capture-raw"
          >Engine: {{ engineLabel }}</small>
          <div
            v-if="extras.length"
            class="capture-alts"
          >
            <button
              v-for="candidate in extras"
              :key="candidate.value"
              type="button"
              @click="selected = candidate.value"
            >
              {{ formatValue(candidate.value) }}
            </button>
          </div>
        </div>
        <div
          v-else-if="phase === 'review'"
          class="capture-readout"
        >
          <small>{{ ocrError || 'No number found.' }}</small>
          <small
            v-if="rawText"
            class="capture-raw"
          >OCR: {{ rawText }}</small>
          <small
            v-if="engineLabel"
            class="capture-raw"
          >Engine: {{ engineLabel }}</small>
        </div>
      </div>

      <template v-if="phase === 'camera'">
        <div class="capture-toolbar">
          <button
            type="button"
            class="capture-tool"
            @click="openLibrary"
          >
            Photo library
          </button>
          <button
            type="button"
            class="capture-shutter"
            aria-label="Take photo"
            :disabled="cameraState !== 'live' || recognizing"
            @click="takePhoto"
          />
          <span aria-hidden="true" />
        </div>
      </template>
      <template v-else-if="phase === 'review'">
        <div class="capture-actions">
          <button
            type="button"
            class="btn-ghost"
            @click="retake"
          >
            Retake
          </button>
          <button
            type="button"
            class="btn-primary-action !min-h-12 !text-base"
            :disabled="!selected"
            @click="useSelected"
          >
            Use this number
          </button>
        </div>
      </template>

      <input
        ref="libraryInput"
        class="sr-only"
        type="file"
        accept="image/*"
        @change="onLibrary"
      >
    </div>
  </Teleport>
</template>
