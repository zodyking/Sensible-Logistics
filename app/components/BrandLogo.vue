<script setup lang="ts">
withDefaults(defineProps<{
  compact?: boolean
  alt?: string
}>(), {
  compact: false,
  alt: 'Gantry',
})
</script>

<template>
  <img
    src="/brand/logo.png"
    :alt="alt"
    class="brand-logo"
    :class="{ compact }"
    decoding="async"
  >
</template>
