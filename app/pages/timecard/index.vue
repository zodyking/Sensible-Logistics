<script setup lang="ts">
/**
 * Driver Time tab is gone — send leftover bookmarks to Tasks.
 */
await navigateTo('/tasks', { replace: true })
</script>

<template>
  <section class="d-page">
    <p class="text-sm text-[var(--color-ink-500)]">
      Redirecting to Tasks…
    </p>
  </section>
</template>
