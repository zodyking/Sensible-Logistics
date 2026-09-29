<script setup lang="ts">
import { shareTripSms } from '~/utils/share-trip-sms'

const props = defineProps<{
  open: boolean
  text: string
}>()

const emit = defineEmits<{ close: [] }>()

const sharing = ref(false)
const shareError = ref('')
const copied = ref(false)

watch(
  () => props.open,
  (open) => {
    if (open) return
    sharing.value = false
    shareError.value = ''
    copied.value = false
  },
)

async function share() {
  if (!props.text || sharing.value) return
  sharing.value = true
  shareError.value = ''
  copied.value = false
  try {
    const result = await shareTripSms({ text: props.text })
    copied.value = result.copied
    if (result.aborted) return
    if (result.shared) {
      emit('close')
      return
    }
    if (result.copied) {
      shareError.value = 'List copied. Share is not available on this device — paste it into Messages.'
      return
    }
    shareError.value = 'Could not copy or share the list. Select the text below and copy it manually.'
  }
  catch {
    shareError.value = 'Could not open the share sheet.'
  }
  finally {
    sharing.value = false
  }
}
</script>

<template>
  <BottomSheet
    :open="open"
    title="Export list"
    @close="emit('close')"
  >
    <p class="sms-share-lead">
      The list is copied first, then your phone’s share sheet opens so you can send it to a conversation.
    </p>
    <pre
      class="sms-preview"
      data-testid="location-export-preview"
    >{{ text }}</pre>
    <p
      v-if="shareError"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ shareError }}</span>
    </p>
    <p
      v-else-if="copied"
      class="banner ok"
      role="status"
    >
      <span aria-hidden="true">✓</span>
      <span>Copied to the clipboard.</span>
    </p>
    <div class="sheet-actions">
      <button
        type="button"
        class="btn-cancel"
        :disabled="sharing"
        @click="emit('close')"
      >
        Close
      </button>
      <button
        type="button"
        class="btn-save"
        :disabled="!text || sharing"
        @click="share"
      >
        {{ sharing ? 'Opening…' : 'Copy & Share' }}
      </button>
    </div>
  </BottomSheet>
</template>
