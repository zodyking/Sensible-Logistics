<script setup lang="ts">
/**
 * Wizard chrome: a back affordance on the left and the step name centred.
 * One screen asks one thing, so the title carries the question and the body
 * stays free of headings.
 */
defineProps<{
  title: string
  backLabel?: string
  /** Route for the back affordance. Omit to emit `back` instead. */
  backTo?: string
}>()

defineEmits<{ back: [] }>()
</script>

<template>
  <div>
    <div class="wiz-nav">
      <NuxtLink
        v-if="backTo"
        :to="backTo"
        class="wiz-back"
      >
        <span
          class="wiz-back-glyph"
          aria-hidden="true"
        >‹</span>
        {{ backLabel ?? 'Back' }}
      </NuxtLink>
      <button
        v-else
        type="button"
        class="wiz-back"
        @click="$emit('back')"
      >
        <span
          class="wiz-back-glyph"
          aria-hidden="true"
        >‹</span>
        {{ backLabel ?? 'Back' }}
      </button>

      <h1 class="wiz-nav-title">
        {{ title }}
      </h1>

      <span class="wiz-nav-end">
        <slot name="end" />
      </span>
    </div>

    <div class="wiz-gap" />
  </div>
</template>
