<script setup lang="ts">
/**
 * Status chip. The variant supplies both a colour and a leading glyph, so
 * status is never communicated by colour alone (spec 22, WCAG 1.4.1).
 */
withDefaults(defineProps<{
  variant?: 'ok' | 'warn' | 'err' | 'transit' | 'idle'
  label: string
  /** Drops the glyph for neutral metadata chips such as `40' HC`. */
  plain?: boolean
}>(), {
  variant: 'idle',
  plain: false,
})
</script>

<template>
  <span
    class="chip"
    :class="[variant, { plain }]"
  >{{ label }}</span>
</template>
