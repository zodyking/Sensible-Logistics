<script setup lang="ts">
withDefaults(defineProps<{
  label?: string
}>(), {
  label: 'Reading the photo…',
})
</script>

<template>
  <div
    class="card scan-page-loader"
    role="status"
    aria-live="polite"
    aria-busy="true"
  >
    <span
      class="scan-spinner ink"
      aria-hidden="true"
    />
    <p>{{ label }}</p>
  </div>
</template>
