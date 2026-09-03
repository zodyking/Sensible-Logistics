<script setup lang="ts">
import { resolveProductName } from '#shared/utils/brand'

const appName = computed(() => resolveProductName(useRuntimeConfig().public.appName))

useHead({
  titleTemplate: title => (title ? `${title} · ${appName.value}` : appName.value),
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
