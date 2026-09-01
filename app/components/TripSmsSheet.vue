<script setup lang="ts">
import type { ContainerType, TripStatus } from '#shared/utils/domain'
import { formatSwapSmsMessage, formatTripSmsMessage, tripSmsAction } from '#shared/utils/trip-sms'
import type { TripSmsFields } from '#shared/utils/trip-sms'
import { shareTripSms } from '~/utils/share-trip-sms'
import {
  dataUrlToBlob,
  dataUrlToFile,
  displayShareFileName,
  isImageShareFile,
  listTripShareFilesFromTrips,
  nextAttachmentSelection,
} from '~/utils/trip-share-files'
import type { ShareNameInput, TripShareFile } from '~/utils/trip-share-files'

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
const attachmentFiles = ref<TripShareFile[]>([])
const selectedNames = ref<Set<string>>(new Set())
const preview = ref<TripShareFile | null>(null)

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

const attachmentTripIds = computed(() => {
  if (isSwap.value) {
    return [props.swapPicked?.tripId, props.swapDropped?.tripId].filter(Boolean) as string[]
  }
  if (action.value === 'pickup' && props.tripId) return [props.tripId]
  return []
})

const namesByTrip = computed(() => {
  const map: Record<string, ShareNameInput> = {}
  function add(id: string | null | undefined, containerNumber?: string | null, chassisNumber?: string | null) {
    if (!id) return
    map[id] = { containerNumber, chassisNumber }
  }
  add(props.tripId, props.containerNumber, props.chassisNumber)
  add(props.swapPicked?.tripId, props.swapPicked?.containerNumber, props.swapPicked?.chassisNumber)
  add(props.swapDropped?.tripId, props.swapDropped?.containerNumber, props.swapDropped?.chassisNumber)
  return map
})

function shownName(file: TripShareFile) {
  return displayShareFileName(file, {
    containerNumber: props.containerNumber,
    chassisNumber: props.chassisNumber,
  })
}

const selectedFiles = computed(() =>
  attachmentFiles.value
    .filter(file => selectedNames.value.has(file.fileName))
    .map(file => dataUrlToFile(file.dataUrl, shownName(file))),
)

const attachmentCount = computed(() => selectedFiles.value.length)
const availableCount = computed(() => attachmentFiles.value.length)

const attachmentHint = computed(() => {
  if (isSwap.value) {
    if (availableCount.value === 0) {
      return 'No container photos or documents on this swap yet. Add them from Documents, then send again.'
    }
    if (attachmentCount.value === 0) {
      return 'No files will attach this send.'
    }
    if (attachmentCount.value < availableCount.value) {
      return `${attachmentCount.value} of ${availableCount.value} files from this swap will attach.`
    }
    const noun = attachmentCount.value === 1 ? 'file' : 'files'
    return `${attachmentCount.value} ${noun} from this swap will attach.`
  }
  if (action.value === 'dropoff') {
    return 'Drop-off messages are text only. Photos and documents stay off this send.'
  }
  if (availableCount.value === 0) {
    return 'No container photos or documents are saved on this pickup yet. Add them from Documents on this trip, then send again.'
  }
  if (attachmentCount.value === 0) {
    return 'No files will attach this send.'
  }
  if (attachmentCount.value < availableCount.value) {
    return `${attachmentCount.value} of ${availableCount.value} files will attach with the message.`
  }
  const noun = attachmentCount.value === 1 ? 'file' : 'files'
  return `${attachmentCount.value} ${noun} (container photos and uploaded documents) will attach with the message.`
})

function applyFiles(next: TripShareFile[]) {
  selectedNames.value = nextAttachmentSelection(
    selectedNames.value,
    attachmentFiles.value.map(file => file.fileName),
    next.map(file => file.fileName),
  )
  attachmentFiles.value = next
}

function toggleFile(name: string) {
  const next = new Set(selectedNames.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  selectedNames.value = next
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

watch(
  () => [props.open, attachmentTripIds.value.join('|'), namesByTrip.value] as const,
  async ([open, ids]) => {
    shareError.value = ''
    copied.value = false
    preview.value = null
    attachmentFiles.value = []
    selectedNames.value = new Set()
    if (!open || !ids) return
    const next = await listTripShareFilesFromTrips(ids.split('|').filter(Boolean), namesByTrip.value)
    if (props.open && attachmentTripIds.value.join('|') === ids) applyFiles(next)
  },
  { immediate: true },
)

async function share() {
  if (!action.value || sharing.value) return
  sharing.value = true
  shareError.value = ''
  copied.value = false
  try {
    const result = await shareTripSms({
      text: message.value,
      files: selectedFiles.value,
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
      <fieldset
        v-if="availableCount"
        class="sms-doc-picker"
      >
        <legend>
          On this trip
        </legend>
        <label
          v-for="file in attachmentFiles"
          :key="file.fileName"
          class="sms-doc-pick"
        >
          <input
            type="checkbox"
            :checked="selectedNames.has(file.fileName)"
            :disabled="sharing"
            @change="toggleFile(file.fileName)"
          >
          <button
            type="button"
            class="sms-doc-open"
            :disabled="sharing"
            @click.prevent="viewFile(file)"
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
            <span class="sms-doc-name">{{ shownName(file) }}</span>
          </button>
        </label>
      </fieldset>
      <div
        v-if="preview"
        class="doc-preview"
      >
        <p class="doc-preview-name">
          {{ shownName(preview) }}
        </p>
        <img
          :src="preview.dataUrl"
          :alt="shownName(preview)"
        >
        <button
          type="button"
          class="btn-ghost mt-3 w-full"
          @click="preview = null"
        >
          Back to files
        </button>
      </div>
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
