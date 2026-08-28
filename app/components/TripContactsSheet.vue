<script setup lang="ts">
import { formatPhoneDisplay, toE164 } from '#shared/utils/phone'
import { locationPhoneLines } from '#shared/utils/trip-contacts'
import type { LocationPhones } from '#shared/utils/trip-contacts'

const props = defineProps<{
  open: boolean
  origin?: LocationPhones | null
  destination?: LocationPhones | null
}>()

const emit = defineEmits<{ close: [] }>()

const copiedKey = ref('')
const copyError = ref('')

watch(
  () => props.open,
  (open) => {
    if (!open) {
      copiedKey.value = ''
      copyError.value = ''
    }
  },
)

const originLines = computed(() => locationPhoneLines(props.origin))
const destinationLines = computed(() => locationPhoneLines(props.destination))
const hasAny = computed(() => originLines.value.length + destinationLines.value.length > 0)

async function copyNumber(phone: string, key: string) {
  copyError.value = ''
  const text = formatPhoneDisplay(phone) || phone
  try {
    await navigator.clipboard.writeText(text)
    copiedKey.value = key
  }
  catch {
    copyError.value = 'Could not copy. Long-press the number instead.'
    copiedKey.value = ''
  }
}
</script>

<template>
  <BottomSheet
    :open="open"
    title="Contacts"
    @close="emit('close')"
  >
    <p
      v-if="copyError"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ copyError }}</span>
    </p>
    <p
      v-else-if="copiedKey"
      class="banner ok"
      role="status"
    >
      <span aria-hidden="true">✓</span>
      <span>Copied to the clipboard.</span>
    </p>

    <p
      v-if="!origin && !destination"
      class="text-sm text-[var(--color-ink-500)]"
    >
      No pickup or drop-off is on this trip yet.
    </p>

    <template v-else>
      <section class="contact-place">
        <span class="field-label">Pickup</span>
        <b>{{ origin?.name || 'Not set' }}</b>
        <div
          v-for="line in originLines"
          :key="`origin-${line.key}`"
          class="contact-row"
        >
          <button
            type="button"
            class="contact-copy"
            @click="copyNumber(line.phone, `origin-${line.key}`)"
          >
            <small>{{ line.label }}<template v-if="line.person"> · {{ line.person }}</template></small>
            <strong>{{ formatPhoneDisplay(line.phone) || line.phone }}</strong>
          </button>
          <a
            class="contact-call"
            :href="`tel:${toE164(line.phone)}`"
            :aria-label="`Call ${formatPhoneDisplay(line.phone) || line.phone}`"
          >☎</a>
        </div>
        <p
          v-if="origin && !originLines.length"
          class="contact-empty"
        >
          No numbers on file.
        </p>
      </section>

      <section class="contact-place">
        <span class="field-label">Drop-off</span>
        <b>{{ destination?.name || 'Not set' }}</b>
        <div
          v-for="line in destinationLines"
          :key="`destination-${line.key}`"
          class="contact-row"
        >
          <button
            type="button"
            class="contact-copy"
            @click="copyNumber(line.phone, `destination-${line.key}`)"
          >
            <small>{{ line.label }}<template v-if="line.person"> · {{ line.person }}</template></small>
            <strong>{{ formatPhoneDisplay(line.phone) || line.phone }}</strong>
          </button>
          <a
            class="contact-call"
            :href="`tel:${toE164(line.phone)}`"
            :aria-label="`Call ${formatPhoneDisplay(line.phone) || line.phone}`"
          >☎</a>
        </div>
        <p
          v-if="destination && !destinationLines.length"
          class="contact-empty"
        >
          No numbers on file.
        </p>
      </section>

      <p
        v-if="hasAny"
        class="contact-hint"
      >
        Tap a number to copy it. The phone icon dials it.
      </p>
    </template>

    <div class="sheet-actions">
      <button
        type="button"
        class="btn-cancel"
        @click="emit('close')"
      >
        Close
      </button>
    </div>
  </BottomSheet>
</template>
