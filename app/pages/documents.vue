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
      title="No documents yet"
      description="EIRs, PODs and gate tickets attach to a pickup or drop-off once object storage is on."
    />
  </section>
</template>
