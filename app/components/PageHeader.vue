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
    <NuxtLink
      v-if="backTo"
      :to="backTo"
      class="mb-2 inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-md)] py-2 pr-3 text-sm font-semibold text-[var(--color-blue-500)]"
    >
      <span aria-hidden="true">‹</span>{{ backLabel ?? 'Back' }}
    </NuxtLink>
    <span
      v-if="eyebrow"
      class="eyebrow block"
    >{{ eyebrow }}</span>
    <h1 class="d-title">
      {{ title }}
    </h1>
  </div>
</template>
