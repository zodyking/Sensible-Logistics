<script setup lang="ts">
/**
 * Wizard chrome: a back affordance on the left and the step name centred.
 * One screen asks one thing, so the title carries the question and the body
 * stays free of headings.
 */
const props = defineProps<{
  title: string
  backLabel?: string
  /** Route for the back affordance. Omit to emit `back` instead. */
  backTo?: string
  /** Hide the left control (Home is redundant with the tab bar). */
  showBack?: boolean
}>()

defineEmits<{ back: [] }>()

const showBackControl = computed(() => {
  if (props.showBack === false) return false
  const label = (props.backLabel ?? '').trim().toLowerCase()
  return props.backTo !== '/' && label !== 'home'
})
</script>

<template>
  <div>
    <div class="wiz-nav">
      <NuxtLink
        v-if="showBackControl && backTo"
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
        v-else-if="showBackControl"
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
