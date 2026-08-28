<script setup lang="ts">
/**
 * Pass or fail for one field, plus an optional reason behind an info button.
 *
 * Drivers read these screens in a yard, so a field says whether it is good with
 * a single mark. Wording only appears when it is asked for.
 */
const props = withDefaults(defineProps<{
  state?: 'ok' | 'error' | 'idle'
  detail?: string
  label?: string
}>(), {
  state: 'idle',
  detail: '',
  label: 'this entry',
})

const open = ref(false)

watch(() => props.detail, (detail) => {
  if (!detail) open.value = false
})

const markLabel = computed(() => (props.state === 'ok' ? `Valid ${props.label}` : `Check ${props.label}`))
</script>

<template>
  <span
    v-if="state !== 'idle' || detail"
    class="fstatus"
  >
    <span
      v-if="state !== 'idle'"
      class="fstatus-mark"
      :class="state"
      role="img"
      :aria-label="markLabel"
    >
      <svg
        viewBox="0 0 20 20"
        aria-hidden="true"
      >
        <path
          v-if="state === 'ok'"
          d="M5 10.5l3.2 3.2L15 7"
        />
        <path
          v-else
          d="M6.5 6.5l7 7M13.5 6.5l-7 7"
        />
      </svg>
    </span>

    <button
      v-if="detail"
      type="button"
      class="fstatus-info"
      :aria-expanded="open"
      :aria-label="open ? 'Hide the reason' : 'Why?'"
      @click="open = !open"
    >
      <svg
        viewBox="0 0 20 20"
        aria-hidden="true"
      >
        <circle
          cx="10"
          cy="10"
          r="8"
        />
        <path d="M10 9v5" />
        <circle
          cx="10"
          cy="6.2"
          r="0.9"
          class="dot"
        />
      </svg>
    </button>

    <span
      v-if="open && detail"
      class="fstatus-pop"
      role="status"
    >{{ detail }}</span>
  </span>
</template>
