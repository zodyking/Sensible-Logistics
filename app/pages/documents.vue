<script setup lang="ts">
useHead({ title: 'My Documents' })
</script>

<template>
  <section class="d-page">
    <PageHeader
      eyebrow="Account"
      title="My Documents"
      back-to="/more"
      back-label="More"
    />
    <EmptyState
      glyph="▤"
      title="Documents live on a swap"
      description="EIRs, PODs, gate tickets and photos attach from Home when you swap an empty for a load. Open the dashboard to upload against the current stop."
    />
    <NuxtLink
      to="/"
      class="btn-dark home-cta"
    >
      Back to Home
    </NuxtLink>
  </section>
</template>
