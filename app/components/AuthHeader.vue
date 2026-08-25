<script setup lang="ts">
/**
 * Centred heading for the signed-out screens.
 *
 * The subtitle sits below the title so the page name is what the eye lands on
 * first — unlike `PageHeader`, where the eyebrow is a breadcrumb-style label
 * for signed-in navigation.
 */
defineProps<{
  title: string
  subtitle?: string
}>()
</script>

<template>
  <div class="mb-4 text-center">
    <h1 class="d-title !mb-1">
      {{ title }}
    </h1>
    <p
      v-if="subtitle"
      class="eyebrow"
    >
      {{ subtitle }}
    </p>
  </div>
</template>
