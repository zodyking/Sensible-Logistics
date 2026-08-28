<script setup lang="ts">
import { deleteTripShareFile, listTripShareFiles, rememberTripShareBlobs } from '~/utils/trip-share-files'
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
  return file.kind === 'photo' ? 'Photo' : 'Document'
}
</script>

<template>
  <BottomSheet
    :open="open"
    title="Trip documents"
    @close="emit('close')"
  >
    <p class="text-sm text-[var(--color-ink-500)]">
      Photos and files for this pickup stay on this phone and attach to the dispatch SMS.
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
        <div>
          <b>{{ file.fileName }}</b>
          <small>{{ kindLabel(file) }}</small>
        </div>
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
      v-else
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
