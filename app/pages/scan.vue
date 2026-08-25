<script setup lang="ts">
import { formatContainerNumber, normalizeContainerNumber, validateContainerNumber } from '#shared/utils/iso6346'

useHead({ title: 'Scan' })

const videoEl = ref<HTMLVideoElement | null>(null)
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
      video: { facingMode: { ideal: 'environment' } },
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

/* --- OCR (Phase 2 service) --------------------------------------- */
const recognizing = ref(false)
const ocrMessage = ref('')
const candidates = ref<Array<{ value: string, confidence: number, band: string }>>([])

async function recognize() {
  recognizing.value = true
  ocrMessage.value = ''
  candidates.value = []

  try {
    const result = await $fetch('/api/scan/recognize', {
      method: 'POST',
      body: { profile: 'container' },
    })
    candidates.value = result.candidates.map(c => ({ value: c.value, confidence: c.confidence, band: c.band }))
    ocrMessage.value = result.message ?? ''
  }
  catch (error) {
    ocrMessage.value = apiErrorMessage(error, 'Recognition failed. Use manual entry.')
  }
  finally {
    recognizing.value = false
  }
}

/* --- Manual entry, always available ------------------------------ */
const manual = ref('')
const normalized = computed(() => normalizeContainerNumber(manual.value))
const validation = computed(() => validateContainerNumber(manual.value))
const showValidation = computed(() => normalized.value.length >= 11)

const lookupState = ref<'idle' | 'searching' | 'missing'>('idle')

async function lookup() {
  if (normalized.value.length !== 11) return
  lookupState.value = 'searching'

  try {
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
</script>

<template>
  <section class="d-page">
    <PageHeader
      eyebrow="Capture"
      title="Scan a container"
    />

    <!-- ── Camera ──────────────────────────────────────────────── -->
    <div class="card overflow-hidden">
      <div class="relative aspect-[4/3] bg-[var(--color-navy-950)]">
        <video
          ref="videoEl"
          class="size-full object-cover"
          playsinline
          muted
        />

        <!-- Framing guide sized for container identification markings -->
        <div
          v-if="cameraState === 'live'"
          class="pointer-events-none absolute inset-x-6 top-1/2 h-20 -translate-y-1/2 rounded border-2 border-[var(--color-amber-500)]"
          aria-hidden="true"
        >
          <span class="absolute -top-6 left-0 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-amber-500)]">
            Frame the number
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
              {{ cameraMessage || 'Start the camera to capture the container number.' }}
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
      v-if="ocrMessage"
      class="banner warn mt-4"
      role="status"
    >
      <span aria-hidden="true">!</span>
      <span>
        <b>OCR unavailable</b>
        {{ ocrMessage }}
      </span>
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
          @click="manual = candidate.value"
        >
          <span class="row-main">
            <b class="mono">{{ formatContainerNumber(candidate.value) }}</b>
            <small>{{ candidate.band }} confidence · {{ Math.round(candidate.confidence * 100) }}%</small>
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
        <span>Container number</span>
        <input
          v-model="manual"
          class="input mono"
          :class="{ invalid: showValidation && !validation.structureValid }"
          placeholder="MSCU4521894"
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          maxlength="15"
          aria-describedby="scan-validation"
        >
      </label>

      <div
        id="scan-validation"
        aria-live="polite"
      >
        <p
          v-if="showValidation && validation.valid"
          class="banner ok mb-3"
        >
          <span aria-hidden="true">✓</span>
          <span><b>{{ formatContainerNumber(normalized) }}</b> Check digit is valid.</span>
        </p>
        <p
          v-else-if="showValidation"
          class="banner warn mb-3"
        >
          <span aria-hidden="true">!</span>
          <span>{{ validation.errors[0] }}</span>
        </p>
      </div>

      <button
        class="btn-dark"
        :disabled="normalized.length !== 11 || lookupState === 'searching'"
        @click="lookup"
      >
        {{ lookupState === 'searching' ? 'Looking up…' : 'Open container record' }}
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
      to="/pickups/new"
      class="btn-primary-action mt-4"
    >
      Start a pickup with this number
    </NuxtLink>

    <p class="mt-6 text-xs text-[var(--color-ink-500)]">
      Container photos are never sent to a third-party OCR service. Recognition runs on self-hosted
      PaddleOCR, and every reading is confirmed by you before it becomes a custody event.
    </p>
  </section>
</template>
