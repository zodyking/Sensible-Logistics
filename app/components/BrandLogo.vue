<script setup lang="ts">
withDefaults(defineProps<{
  compact?: boolean
  alt?: string
}>(), {
  compact: false,
  alt: 'Sensible Logistics Solutions',
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
