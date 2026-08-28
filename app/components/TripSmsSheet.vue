<script setup lang="ts">
import type { ContainerType, TripStatus } from '#shared/utils/domain'
import { formatSwapSmsMessage, formatTripSmsMessage, tripSmsAction } from '#shared/utils/trip-sms'
import type { TripSmsFields } from '#shared/utils/trip-sms'
import { shareTripSms } from '~/utils/share-trip-sms'
import { rememberTripShareBlobs, tripShareFilesAsFiles } from '~/utils/trip-share-files'

type TripSmsSheetFields = TripSmsFields & {
  tripId?: string | null
  status?: TripStatus | null
}

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
  /** Outbound load + empty left at the customer while both trips are live. */
  swapPicked?: TripSmsSheetFields | null
  swapDropped?: TripSmsSheetFields | null
}>()

const emit = defineEmits<{ close: [] }>()

const sharing = ref(false)
const shareError = ref('')
const copied = ref(false)
const attachmentFiles = ref<File[]>([])

const isSwap = computed(() => Boolean(
  props.swapPicked
  && props.swapDropped
  && tripSmsAction(props.swapPicked.status)
  && tripSmsAction(props.swapDropped.status),
))

const action = computed(() => {
  if (isSwap.value) return 'pickup' as const
  return tripSmsAction(props.status)
})

function toFields(input: TripSmsSheetFields | typeof props): TripSmsFields {
  return {
    isLoaded: Boolean(input.isLoaded),
    containerNumber: input.containerNumber,
    sealNumber: input.sealNumber,
    chassisNumber: input.chassisNumber,
    containerType: input.containerType,
    originName: input.originName,
    destinationName: input.destinationName,
    customer: input.customer,
  }
}

const message = computed(() => {
  if (isSwap.value && props.swapPicked && props.swapDropped) {
    return formatSwapSmsMessage(toFields(props.swapPicked), toFields(props.swapDropped))
  }
  if (!action.value) return ''
  return formatTripSmsMessage(action.value, toFields(props))
})

const attachmentTripId = computed(() => {
  if (isSwap.value) return props.swapDropped?.tripId ?? null
  if (action.value === 'pickup') return props.tripId ?? null
  return null
})

const attachmentCount = computed(() => attachmentFiles.value.length)

const attachmentHint = computed(() => {
  if (isSwap.value) {
    if (attachmentCount.value === 0) {
      return 'Attach the empty’s container photo and documents — the box left at the customer.'
    }
    const noun = attachmentCount.value === 1 ? 'file' : 'files'
    return `${attachmentCount.value} ${noun} from the empty left at the customer will attach.`
  }
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
  () => [props.open, attachmentTripId.value] as const,
  async ([open, tripId]) => {
    shareError.value = ''
    copied.value = false
    attachmentFiles.value = []
    if (!open || !tripId) return
    const next = await tripShareFilesAsFiles(tripId)
    if (props.open && attachmentTripId.value === tripId) attachmentFiles.value = next
  },
)

async function onAddFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = [...input.files ?? []]
  input.value = ''
  if (!attachmentTripId.value || !selected.length) return
  shareError.value = ''
  try {
    await rememberTripShareBlobs(attachmentTripId.value, selected)
    attachmentFiles.value = await tripShareFilesAsFiles(attachmentTripId.value)
  }
  catch {
    shareError.value = 'Could not attach those files.'
  }
}

async function share() {
  if (!action.value || sharing.value) return
  sharing.value = true
  shareError.value = ''
  copied.value = false
  try {
    const result = await shareTripSms({
      text: message.value,
      files: attachmentTripId.value ? attachmentFiles.value : [],
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
        v-if="attachmentTripId"
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
