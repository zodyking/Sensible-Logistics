<script setup lang="ts">
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerSrc

const props = defineProps<{
  bytes: Uint8Array | null
}>()

const emit = defineEmits<{
  close: []
  download: []
}>()

const stage = ref<HTMLElement | null>(null)
const rendering = ref(true)
const renderError = ref('')

async function renderPdf() {
  renderError.value = ''
  rendering.value = true
  const host = stage.value
  const bytes = props.bytes
  if (!host || !bytes) {
    rendering.value = false
    return
  }
  host.replaceChildren()
  try {
    const pdf = await getDocument({
      data: bytes.slice(),
      disableRange: true,
      disableStream: true,
    }).promise
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const base = page.getViewport({ scale: 1 })
      const width = Math.min(host.clientWidth || 360, 720)
      const scale = width / base.width
      const viewport = page.getViewport({ scale: Math.max(scale, 1.1) })
      const canvas = document.createElement('canvas')
      canvas.className = 'tc-pdf-page'
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const context = canvas.getContext('2d')
      if (!context) continue
      await page.render({ canvas, canvasContext: context, viewport }).promise
      host.appendChild(canvas)
    }
  }
  catch (err) {
    renderError.value = err instanceof Error ? err.message : 'Could not draw the time card PDF.'
  }
  finally {
    rendering.value = false
  }
}

watch(() => props.bytes, () => {
  void nextTick(() => renderPdf())
})

onMounted(() => {
  document.body.style.overflow = 'hidden'
  void renderPdf()
})

onBeforeUnmount(() => {
  document.body.style.overflow = ''
})
</script>

<template>
  <div
    class="tc-pdf-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Time card PDF"
  >
    <button
      type="button"
      class="pdf-close"
      @click="emit('close')"
    >
      Close
    </button>
    <p
      v-if="rendering"
      class="tc-pdf-status"
      role="status"
    >
      Drawing the printed card…
    </p>
    <p
      v-else-if="renderError"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ renderError }}</span>
    </p>
    <div
      ref="stage"
      class="tc-pdf-stage"
    />
    <button
      type="button"
      class="pdf-close"
      @click="emit('download')"
    >
      Download PDF
    </button>
  </div>
</template>
