<script setup lang="ts">
withDefaults(defineProps<{
  glyph?: string
  title: string
  description?: string
}>(), {
  glyph: '▦',
})
</script>

<template>
  <div class="empty-state card">
    <span
      class="glyph"
      aria-hidden="true"
    >{{ glyph }}</span>
    <b>{{ title }}</b>
    <small v-if="description">{{ description }}</small>
    <div
      v-if="$slots.default"
      class="mt-4 flex justify-center"
    >
      <slot />
    </div>
  </div>
</template>
