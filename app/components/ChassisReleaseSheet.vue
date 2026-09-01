<script setup lang="ts">
defineProps<{
  open: boolean
  title?: string
  message: string
  busy?: boolean
}>()

const emit = defineEmits<{
  close: []
  confirm: []
}>()
</script>

<template>
  <BottomSheet
    :open="open"
    :title="title || 'Chassis already in use'"
    @close="emit('close')"
  >
    <p class="text-sm text-[var(--color-ink-700)]">
      {{ message }}
    </p>
    <div class="sheet-actions">
      <button
        type="button"
        class="btn-cancel"
        :disabled="busy"
        @click="emit('close')"
      >
        Keep it there
      </button>
      <button
        type="button"
        class="btn-save"
        :disabled="busy"
        @click="emit('confirm')"
      >
        {{ busy ? 'Releasing…' : 'Release and use' }}
      </button>
    </div>
  </BottomSheet>
</template>
