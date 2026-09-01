<script setup lang="ts">
/**
 * Wizard chrome: a back affordance on the left, the step name centred, and the
 * step count kept quiet on the right. One screen asks one thing, so the title
 * carries the question and the body stays free of headings.
 */
const props = withDefaults(defineProps<{
  title: string
  backLabel?: string
  /** Route for the back affordance. Omit to emit `back` instead. */
  backTo?: string
  step?: number
  steps?: number
}>(), {
  backLabel: 'Back',
})

defineEmits<{ back: [] }>()

const count = computed(() => {
  if (!props.steps || props.step === undefined) return null
  return `${props.step + 1} of ${props.steps}`
})
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
        {{ backLabel }}
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
        {{ backLabel }}
      </button>

      <h1 class="wiz-nav-title">
        {{ title }}
      </h1>

      <span class="wiz-nav-end">
        <slot name="end">
          <span
            v-if="count"
            class="wiz-step-count"
          >{{ count }}</span>
        </slot>
      </span>
    </div>

    <div class="wiz-gap" />
  </div>
</template>
