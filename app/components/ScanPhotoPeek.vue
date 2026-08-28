<script setup lang="ts">
defineProps<{
  src: string
}>()

const open = ref(false)
</script>

<template>
  <div class="scan-peek">
    <button
      type="button"
      class="scan-peek-toggle"
      :aria-expanded="open"
      aria-controls="scan-peek-frame"
      @click="open = !open"
    >
      <span>{{ open ? 'Hide photo' : 'View photo' }}</span>
      <span
        class="scan-peek-chev"
        :class="{ open }"
        aria-hidden="true"
      >›</span>
    </button>
    <div
      v-if="open"
      id="scan-peek-frame"
      class="scan-peek-frame"
    >
      <img
        :src="src"
        alt="Equipment photo from this scan"
      >
    </div>
  </div>
</template>
