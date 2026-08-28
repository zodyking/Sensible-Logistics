<script setup lang="ts">
import type { ContainerType, TripStatus } from '#shared/utils/domain'
import { formatTripSmsMessage, tripSmsAction } from '#shared/utils/trip-sms'
import { shareTripSms } from '~/utils/share-trip-sms'
import { rememberTripShareBlobs, tripShareFilesAsFiles } from '~/utils/trip-share-files'

const props = defineProps<{
  open: boolean
  tripId?: string | null
  status?: TripStatus | null
  isLoaded?: boolean | null
  containerNumber?: string | null
  sealNumber?: string | null
  chassisNumber?: string | null
  containerType?: ContainerType | null
  originName?: string | null
  destinationName?: string | null
  customer?: string | null
}>()

const emit = defineEmits<{ close: [] }>()

const sharing = ref(false)
const shareError = ref('')
const copied = ref(false)
const attachmentFiles = ref<File[]>([])

const action = computed(() => tripSmsAction(props.status))

const message = computed(() => {
  if (!action.value) return ''
  return formatTripSmsMessage(action.value, {
    isLoaded: Boolean(props.isLoaded),
    containerNumber: props.containerNumber,
    sealNumber: props.sealNumber,
    chassisNumber: props.chassisNumber,
    containerType: props.containerType,
    originName: props.originName,
    destinationName: props.destinationName,
    customer: props.customer,
  })
})

const attachmentCount = computed(() => attachmentFiles.value.length)

const attachmentHint = computed(() => {
  if (action.value === 'dropoff') {
    return 'Drop-off messages are text only. Photos and documents stay off this send.'
  }
  if (attachmentCount.value === 0) {
    return 'No container photos or documents are saved on this pickup yet. The text still copies so you can paste it into the conversation.'
  }
  const noun = attachmentCount.value === 1 ? 'file' : 'files'
  return `${attachmentCount.value} ${noun} (container photos and uploaded documents) will attach with the message.`
})

watch(
  () => [props.open, props.tripId, action.value] as const,
  async ([open, tripId, nextAction]) => {
    shareError.value = ''
    copied.value = false
    attachmentFiles.value = []
    if (!open || !tripId || nextAction !== 'pickup') return
    const files = await tripShareFilesAsFiles(tripId)
    if (props.open && props.tripId === tripId) attachmentFiles.value = files
  },
)

async function onAddFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = [...input.files ?? []]
  input.value = ''
  if (!props.tripId || !selected.length) return
  shareError.value = ''
  try {
    await rememberTripShareBlobs(props.tripId, selected)
    attachmentFiles.value = await tripShareFilesAsFiles(props.tripId)
  }
  catch {
    shareError.value = 'Could not attach those files.'
  }
}

async function share() {
  if (!action.value || !props.tripId || sharing.value) return
  sharing.value = true
  shareError.value = ''
  copied.value = false
  try {
    const result = await shareTripSms({
      text: message.value,
      files: action.value === 'pickup' ? attachmentFiles.value : [],
    })
    copied.value = result.copied
    if (result.aborted) return
    if (result.shared) {
      emit('close')
      return
    }
    if (result.copied) {
      shareError.value = 'Message copied. Share is not available on this device — paste it into Messages.'
      return
    }
    shareError.value = 'Could not copy or share the message. Select the text below and copy it manually.'
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
    title="Send SMS"
    @close="emit('close')"
  >
    <p
      v-if="!action"
      class="text-sm text-[var(--color-ink-500)]"
    >
      Confirm this pickup before sending a dispatch message.
    </p>

    <template v-else>
      <p class="sms-share-lead">
        The message is copied first, then your phone’s share sheet opens so you can send it to a conversation.
      </p>
      <pre
        class="sms-preview"
        data-testid="sms-preview"
      >{{ message }}</pre>
      <p class="sms-share-hint">
        {{ attachmentHint }}
      </p>
      <label
        v-if="action === 'pickup' && tripId"
        class="sms-add-files"
      >
        <input
          type="file"
          class="sr-only"
          accept="image/*,application/pdf"
          multiple
          :disabled="sharing"
          @change="onAddFiles"
        >
        Add photos or documents
      </label>
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
    </template>

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
        :disabled="!action || sharing"
        @click="share"
      >
        {{ sharing ? 'Opening…' : 'Copy & Share' }}
      </button>
    </div>
  </BottomSheet>
</template>
