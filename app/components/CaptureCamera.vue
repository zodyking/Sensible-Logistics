<script setup lang="ts">
withDefaults(defineProps<{
  title?: string
  readingLabel?: string
}>(), {
  title: 'Container and chassis',
  readingLabel: 'Reading the photo…',
})

const emit = defineEmits<{
  close: []
  photo: [dataUrl: string]
}>()

type CameraState = 'starting' | 'live' | 'denied' | 'unsupported'

const videoEl = ref<HTMLVideoElement | null>(null)
const libraryInput = ref<HTMLInputElement | null>(null)
const cameraState = ref<CameraState>('starting')
const cameraMessage = ref('')
const capturing = ref(false)
const previewUrl = ref('')

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
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1080 },
        height: { ideal: 1920 },
        aspectRatio: { ideal: 0.75 },
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
  return canvas.toDataURL('image/jpeg', 0.85)
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

async function normalizeToJpeg(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl)
  return frameToDataUrl(img, img.naturalWidth, img.naturalHeight)
}

async function takePhoto() {
  if (capturing.value || cameraState.value !== 'live') return
  capturing.value = true
  try {
    const image = captureShutter()
    previewUrl.value = image
    stopCamera()
    emit('photo', image)
  }
  catch (error) {
    cameraMessage.value = error instanceof Error ? error.message : 'Could not take the photo.'
    capturing.value = false
  }
}

function openLibrary() {
  libraryInput.value?.click()
}

async function onLibrary(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  capturing.value = true
  try {
    const reader = new FileReader()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(new Error('Could not open that photo.'))
      reader.readAsDataURL(file)
    })
    const jpeg = await normalizeToJpeg(dataUrl)
    previewUrl.value = jpeg
    stopCamera()
    emit('photo', jpeg)
  }
  catch (error) {
    cameraMessage.value = error instanceof Error ? error.message : 'Could not open that photo.'
    capturing.value = false
  }
  finally {
    if (libraryInput.value) libraryInput.value.value = ''
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      class="capture-overlay"
      role="dialog"
      aria-modal="true"
      :aria-busy="Boolean(previewUrl)"
      :aria-label="previewUrl ? 'Reading photo' : title"
    >
      <div class="capture-bar">
        <button
          v-if="!previewUrl"
          type="button"
          class="capture-iconbtn"
          aria-label="Close camera"
          @click="emit('close')"
        >
          ✕
        </button>
        <span
          v-else
          aria-hidden="true"
        />
        <b>{{ previewUrl ? 'Reading photo' : title }}</b>
        <span aria-hidden="true" />
      </div>

      <div class="capture-stage">
        <div class="capture-viewport">
          <img
            v-if="previewUrl"
            :src="previewUrl"
            alt=""
          >
          <video
            v-else
            ref="videoEl"
            playsinline
            muted
            autoplay
          />
          <div
            v-if="previewUrl || cameraState !== 'live'"
            class="capture-stage-msg"
            :class="{ reading: Boolean(previewUrl) }"
            :role="previewUrl ? 'status' : undefined"
          >
            <span
              v-if="previewUrl"
              class="scan-spinner"
              aria-hidden="true"
            />
            <p>{{ previewUrl ? readingLabel : (cameraMessage || 'Starting camera…') }}</p>
          </div>
        </div>
      </div>

      <div
        v-if="!previewUrl"
        class="capture-toolbar"
      >
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
          :disabled="cameraState !== 'live' || capturing"
          @click="takePhoto"
        />
        <span aria-hidden="true" />
      </div>

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
