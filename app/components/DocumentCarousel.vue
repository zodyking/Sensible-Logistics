<script setup lang="ts">
import { DOCUMENT_CATEGORY_LABELS, type DocumentCategory } from '#shared/utils/domain'
import { documentFileSrc, isImageDocument, type ViewerDocument } from '~/utils/documents'

const props = withDefaults(defineProps<{
  documents: ViewerDocument[]
  emptyTitle?: string
  emptyDescription?: string
}>(), {
  emptyTitle: 'No photos or documents',
  emptyDescription: 'Files attached to this container show up here.',
})

const ordered = computed(() => {
  return [...props.documents].sort((a, b) => {
    const aImg = isImageDocument(a) ? 0 : 1
    const bImg = isImageDocument(b) ? 0 : 1
    if (aImg !== bImg) return aImg - bImg
    return 0
  })
})

const fullscreenIndex = ref<number | null>(null)
const failed = ref<Record<string, boolean>>({})

const active = computed(() => (
  fullscreenIndex.value == null ? null : ordered.value[fullscreenIndex.value] ?? null
))

function categoryLabel(doc: ViewerDocument) {
  const key = doc.category as DocumentCategory
  return DOCUMENT_CATEGORY_LABELS[key] ?? doc.category ?? 'Document'
}

function markFailed(id: string) {
  failed.value = { ...failed.value, [id]: true }
}

function openAt(index: number) {
  const doc = ordered.value[index]
  if (!doc) return
  if (!isImageDocument(doc) || failed.value[doc.id]) {
    window.open(documentFileSrc(doc.id), '_blank', 'noopener')
    return
  }
  fullscreenIndex.value = index
}

function closeViewer() {
  fullscreenIndex.value = null
}

function step(delta: number) {
  if (fullscreenIndex.value == null || !ordered.value.length) return
  const next = (fullscreenIndex.value + delta + ordered.value.length) % ordered.value.length
  const doc = ordered.value[next]
  if (doc && isImageDocument(doc) && !failed.value[doc.id]) {
    fullscreenIndex.value = next
    return
  }
  fullscreenIndex.value = next
  if (doc && (!isImageDocument(doc) || failed.value[doc.id])) {
    window.open(documentFileSrc(doc.id), '_blank', 'noopener')
  }
}

function onKey(event: KeyboardEvent) {
  if (fullscreenIndex.value == null) return
  if (event.key === 'Escape') closeViewer()
  if (event.key === 'ArrowRight') step(1)
  if (event.key === 'ArrowLeft') step(-1)
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="doc-viewer">
    <div
      v-if="!ordered.length"
      class="doc-viewer-empty"
    >
      <b>{{ emptyTitle }}</b>
      <p>{{ emptyDescription }}</p>
    </div>

    <div
      v-else
      class="doc-carousel"
      role="list"
    >
      <button
        v-for="(doc, index) in ordered"
        :key="doc.id"
        type="button"
        class="doc-slide"
        role="listitem"
        :aria-label="`Open ${doc.fileName}`"
        @click="openAt(index)"
      >
        <img
          v-if="isImageDocument(doc) && !failed[doc.id]"
          class="doc-slide-img"
          :src="documentFileSrc(doc.id)"
          :alt="doc.fileName"
          @error="markFailed(doc.id)"
        >
        <span
          v-else
          class="doc-slide-file"
          aria-hidden="true"
        >{{ isImageDocument(doc) ? 'IMG' : 'PDF' }}</span>
        <span class="doc-slide-meta">
          <b>{{ doc.fileName }}</b>
          <small>{{ categoryLabel(doc) }}</small>
        </span>
      </button>
    </div>

    <Teleport to="body">
      <div
        v-if="active && fullscreenIndex != null"
        class="doc-lightbox"
        role="dialog"
        aria-modal="true"
        :aria-label="active.fileName"
        @click.self="closeViewer"
      >
        <button
          type="button"
          class="doc-lightbox-close"
          aria-label="Close viewer"
          @click="closeViewer"
        >
          Close
        </button>
        <button
          v-if="ordered.length > 1"
          type="button"
          class="doc-lightbox-nav prev"
          aria-label="Previous"
          @click="step(-1)"
        >
          ‹
        </button>
        <figure class="doc-lightbox-stage">
          <img
            v-if="isImageDocument(active) && !failed[active.id]"
            :src="documentFileSrc(active.id)"
            :alt="active.fileName"
            @error="markFailed(active.id)"
          >
          <iframe
            v-else
            :src="documentFileSrc(active.id)"
            :title="active.fileName"
          />
          <figcaption>
            <b>{{ active.fileName }}</b>
            <span>{{ categoryLabel(active) }} · {{ fullscreenIndex + 1 }} of {{ ordered.length }}</span>
          </figcaption>
        </figure>
        <button
          v-if="ordered.length > 1"
          type="button"
          class="doc-lightbox-nav next"
          aria-label="Next"
          @click="step(1)"
        >
          ›
        </button>
      </div>
    </Teleport>
  </div>
</template>
