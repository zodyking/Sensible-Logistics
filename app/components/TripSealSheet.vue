<script setup lang="ts">
import { LOADED_SEAL_REQUIRED } from '#shared/utils/seal'

const props = defineProps<{
  open: boolean
  tripId: string
  sealNumber?: string | null
}>()

const emit = defineEmits<{
  close: []
  saved: [sealNumber: string]
}>()

const step = ref<'ask' | 'edit'>('ask')
const draft = ref('')
const saving = ref(false)
const errorMessage = ref('')

watch(
  () => props.open,
  (open) => {
    if (!open) return
    step.value = 'ask'
    draft.value = props.sealNumber?.trim() || ''
    saving.value = false
    errorMessage.value = ''
  },
)

function startEdit() {
  errorMessage.value = ''
  step.value = 'edit'
}

async function save() {
  const sealNumber = draft.value.trim()
  if (!sealNumber || saving.value || !props.tripId) {
    if (!sealNumber) errorMessage.value = LOADED_SEAL_REQUIRED
    return
  }
  saving.value = true
  errorMessage.value = ''
  try {
    await $fetch(`/api/trips/${props.tripId}/seal`, {
      method: 'PATCH',
      body: {
        eventId: crypto.randomUUID(),
        sealNumber,
      },
    })
    emit('saved', sealNumber)
    emit('close')
  }
  catch (err) {
    errorMessage.value = apiErrorMessage(err, 'Could not update the seal.')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <BottomSheet
    :open="open"
    :title="step === 'ask' ? 'Edit seal?' : 'Seal'"
    @close="emit('close')"
  >
    <p
      v-if="errorMessage"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ errorMessage }}</span>
    </p>
    <template v-if="step === 'ask'">
      <p class="text-sm text-[var(--color-ink-700)]">
        Change the seal number on this container?
      </p>
      <div class="sheet-actions">
        <button
          type="button"
          class="btn-cancel"
          @click="emit('close')"
        >
          Keep
        </button>
        <button
          type="button"
          class="btn-save"
          @click="startEdit"
        >
          Edit seal
        </button>
      </div>
    </template>
    <template v-else>
      <div class="wiz-group">
        <div class="wiz-row">
          <label
            class="wiz-row-label"
            for="trip-seal-number"
          >Number</label>
          <input
            id="trip-seal-number"
            v-model="draft"
            class="input mono"
            placeholder="required"
            autocapitalize="characters"
            autocomplete="off"
            required
          >
        </div>
      </div>
      <p class="sms-share-hint">
        The card stays the same. Only the seal value changes.
      </p>
      <div class="sheet-actions">
        <button
          type="button"
          class="btn-cancel"
          :disabled="saving"
          @click="emit('close')"
        >
          Cancel
        </button>
        <button
          type="button"
          class="btn-save"
          :disabled="saving || !draft.trim()"
          @click="save"
        >
          {{ saving ? 'Saving…' : 'Save seal' }}
        </button>
      </div>
    </template>
  </BottomSheet>
</template>
