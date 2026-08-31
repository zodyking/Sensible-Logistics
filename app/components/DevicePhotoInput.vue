<script setup lang="ts">
import { fileToDataUrl } from '~/utils/trip-share-files'

defineProps<{
  label: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  photo: [dataUrl: string]
}>()

async function onChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const dataUrl = await fileToDataUrl(file)
  if (dataUrl.startsWith('data:')) emit('photo', dataUrl)
}
</script>

<template>
  <label class="device-photo-input">
    <input
      type="file"
      class="sr-only"
      accept="image/*"
      capture="environment"
      :disabled="disabled"
      @change="onChange"
    >
    {{ label }}
  </label>
</template>
