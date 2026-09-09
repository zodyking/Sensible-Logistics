<script setup lang="ts">
useHead({ title: 'Settings' })
</script>

<template>
  <section class="d-page">
    <PageHeader
      eyebrow="Account"
      title="Settings"
      back-to="/more"
      back-label="More"
    />
    <AccountSettingsForm />
  </section>
</template>
