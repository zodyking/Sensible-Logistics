<script setup lang="ts">
const appName = useRuntimeConfig().public.appName

useHead({
  titleTemplate: title => (title ? `${title} · ${appName}` : appName),
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
