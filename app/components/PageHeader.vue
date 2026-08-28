<script setup lang="ts">
defineProps<{
  eyebrow?: string
  title: string
  backTo?: string
  backLabel?: string
}>()
</script>

<template>
  <div class="mb-1">
    <div
      v-if="backTo"
      class="backbar"
    >
      <NuxtLink
        :to="backTo"
        class="backbtn"
      >
        ‹ {{ backLabel ?? 'Back' }}
      </NuxtLink>
    </div>
    <span
      v-if="eyebrow"
      class="eyebrow block"
    >{{ eyebrow }}</span>
    <div class="d-title-row">
      <h1 class="d-title">
        {{ title }}
      </h1>
      <div
        v-if="$slots.actions"
        class="d-title-actions"
      >
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>
