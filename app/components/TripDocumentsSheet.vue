<script setup lang="ts">
import { dataUrlToBlob, deleteTripShareFile, isImageShareFile, listTripShareFiles, rememberTripShareBlobs } from '~/utils/trip-share-files'
import type { TripShareFile } from '~/utils/trip-share-files'

const props = defineProps<{
  open: boolean
  tripId?: string | null
}>()

const emit = defineEmits<{ close: [] }>()

const files = ref<TripShareFile[]>([])
const pending = ref(false)
const errorMessage = ref('')
const pendingDelete = ref<string | null>(null)
const deleting = ref(false)
const preview = ref<TripShareFile | null>(null)

async function reload() {
  if (!props.tripId) {
    files.value = []
    return
  }
  files.value = await listTripShareFiles(props.tripId)
}

watch(
  () => [props.open, props.tripId] as const,
  async ([open, tripId]) => {
    errorMessage.value = ''
    pendingDelete.value = null
    preview.value = null
    if (!open || !tripId) {
      files.value = []
      return
    }
    await reload()
  },
)

async function onAdd(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = [...input.files ?? []]
  input.value = ''
  if (!props.tripId || !selected.length) return
  pending.value = true
  errorMessage.value = ''
  try {
    await rememberTripShareBlobs(props.tripId, selected)
    await reload()
  }
  catch {
    errorMessage.value = 'Could not add those files.'
  }
  finally {
    pending.value = false
  }
}

async function confirmDelete() {
  if (!props.tripId || !pendingDelete.value || deleting.value) return
  deleting.value = true
  errorMessage.value = ''
  try {
    await deleteTripShareFile(props.tripId, pendingDelete.value)
    pendingDelete.value = null
    await reload()
  }
  catch {
    errorMessage.value = 'Could not delete that file.'
  }
  finally {
    deleting.value = false
  }
}

function kindLabel(file: TripShareFile) {
  if (file.kind === 'document') return 'Document'
  if (/^[A-Z]{4}\d{6}-\d/i.test(file.fileName)) return 'Container scan'
  if (/^[A-Z]{4}\d{6}\b/i.test(file.fileName)) return 'Chassis scan'
  return 'Scan'
}

function viewFile(file: TripShareFile) {
  if (isImageShareFile(file)) {
    preview.value = file
    return
  }
  const url = URL.createObjectURL(dataUrlToBlob(file.dataUrl))
  window.open(url, '_blank', 'noopener')
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
</script>

<template>
  <BottomSheet
    :open="open"
    title="Trip documents"
    @close="emit('close')"
  >
    <p class="text-sm text-[var(--color-ink-500)]">
      Photos and files for this pickup stay on this phone and attach to the dispatch SMS. Tap a file to view it.
    </p>

    <p
      v-if="errorMessage"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ errorMessage }}</span>
    </p>

    <ul
      v-if="files.length"
      class="doc-list"
    >
      <li
        v-for="file in files"
        :key="file.fileName"
        class="doc-row"
      >
        <button
          type="button"
          class="doc-open"
          @click="viewFile(file)"
        >
          <img
            v-if="isImageShareFile(file)"
            class="doc-thumb"
            :src="file.dataUrl"
            alt=""
          >
          <span
            v-else
            class="doc-thumb doc-thumb-file"
            aria-hidden="true"
          >PDF</span>
          <span class="doc-open-copy">
            <b>{{ file.fileName }}</b>
            <small>{{ kindLabel(file) }} · View</small>
          </span>
        </button>
        <button
          type="button"
          class="doc-delete"
          :disabled="Boolean(pendingDelete)"
          @click="pendingDelete = file.fileName"
        >
          Delete
        </button>
      </li>
    </ul>
    <p
      v-else
      class="text-sm text-[var(--color-ink-500)]"
    >
      Nothing saved for this trip yet.
    </p>

    <div
      v-if="preview"
      class="doc-preview"
    >
      <p class="doc-preview-name">
        {{ preview.fileName }}
      </p>
      <img
        :src="preview.dataUrl"
        :alt="preview.fileName"
      >
      <button
        type="button"
        class="btn-ghost mt-3 w-full"
        @click="preview = null"
      >
        Back to files
      </button>
    </div>

    <div
      v-if="pendingDelete"
      class="doc-confirm"
    >
      <p>Delete {{ pendingDelete }}? This cannot be undone.</p>
      <div class="sheet-actions">
        <button
          type="button"
          class="btn-cancel"
          :disabled="deleting"
          @click="pendingDelete = null"
        >
          Keep
        </button>
        <button
          type="button"
          class="btn-save danger"
          :disabled="deleting"
          @click="confirmDelete"
        >
          {{ deleting ? 'Deleting…' : 'Delete' }}
        </button>
      </div>
    </div>

    <div
      v-else-if="!preview"
      class="sheet-actions"
    >
      <button
        type="button"
        class="btn-cancel"
        @click="emit('close')"
      >
        Close
      </button>
      <label class="btn-save sms-add-files-btn">
        <input
          type="file"
          class="sr-only"
          accept="image/*,application/pdf"
          multiple
          :disabled="pending || !tripId"
          @change="onAdd"
        >
        {{ pending ? 'Adding…' : 'Add file' }}
      </label>
    </div>
  </BottomSheet>
</template>
