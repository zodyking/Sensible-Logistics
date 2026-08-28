<script setup lang="ts">
defineProps<{
  heading: number
  aligning?: boolean
  disabled?: boolean
}>()

defineEmits<{
  rotate: [delta: number]
  align: []
  recenter: []
}>()
</script>

<template>
  <div class="map-rotate-bar">
    <button
      type="button"
      class="ybtn"
      aria-label="Rotate map 15 degrees counter-clockwise"
      :disabled="disabled"
      @click="$emit('rotate', -15)"
    >
      ↺ 15°
    </button>
    <button
      type="button"
      class="ybtn"
      aria-label="Rotate map 15 degrees clockwise"
      :disabled="disabled"
      @click="$emit('rotate', 15)"
    >
      ↻ 15°
    </button>
    <button
      type="button"
      class="ybtn"
      aria-label="Rotate map 90 degrees"
      :disabled="disabled"
      @click="$emit('rotate', 90)"
    >
      90°
    </button>
    <button
      type="button"
      class="btn-ghost"
      :disabled="disabled || aligning"
      @click="$emit('align')"
    >
      {{ aligning ? 'Aligning…' : 'Align to road' }}
    </button>
    <button
      type="button"
      class="btn-ghost"
      :disabled="disabled"
      @click="$emit('recenter')"
    >
      Recenter
    </button>
    <slot />
  </div>
  <p class="field-hint mt-2">
    Yard heading {{ Math.round(heading) }}°. Rotate so the street runs straight across the map.
  </p>
</template>
