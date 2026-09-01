<script setup lang="ts">
/**
 * Wizard chrome: a back affordance on the left, the step name centred, and a
 * hairline of progress underneath. One screen asks one thing, so the title
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

const percent = computed(() => {
  if (!props.steps || props.step === undefined) return null
  return Math.round(((props.step + 1) / props.steps) * 100)
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
        <slot name="end" />
      </span>
    </div>

    <div
      v-if="percent !== null"
      class="wiz-progress"
      role="progressbar"
      aria-valuemin="1"
      :aria-valuenow="(step ?? 0) + 1"
      :aria-valuemax="steps"
      :aria-label="`Step ${(step ?? 0) + 1} of ${steps}`"
    >
      <span :style="{ width: `${percent}%` }" />
    </div>
    <div
      v-else
      class="wiz-gap"
    />
  </div>
</template>
