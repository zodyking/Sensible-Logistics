<script setup lang="ts">
defineProps<{
  rotation: number
  aligning?: boolean
}>()

defineEmits<{
  rotate: [delta: number]
  align: []
}>()
</script>

<template>
  <div class="place-tools">
    <button
      type="button"
      class="ybtn"
      aria-label="Rotate 15 degrees counter-clockwise"
      @click="$emit('rotate', -15)"
    >
      ↺ 15°
    </button>
    <button
      type="button"
      class="ybtn"
      aria-label="Rotate 15 degrees clockwise"
      @click="$emit('rotate', 15)"
    >
      ↻ 15°
    </button>
    <button
      type="button"
      class="ybtn"
      aria-label="Rotate 90 degrees"
      @click="$emit('rotate', 90)"
    >
      90°
    </button>
    <button
      type="button"
      class="btn-ghost"
      :disabled="aligning"
      @click="$emit('align')"
    >
      {{ aligning ? 'Aligning…' : 'Align to street' }}
    </button>
  </div>
  <p class="field-hint mt-2">
    Heading {{ Math.round(rotation) }}°. Amber edge is the door end.
  </p>
</template>
