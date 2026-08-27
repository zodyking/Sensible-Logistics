<script setup lang="ts">
useHead({ title: 'Settings' })

const { user } = useUserSession()
</script>

<template>
  <section class="d-page">
    <PageHeader
      eyebrow="Account"
      title="Settings"
      back-to="/more"
      back-label="More"
    />

    <div class="card p-4">
      <label class="field">
        <span>Name</span>
        <input
          class="input"
          :value="user?.fullName"
          readonly
        >
      </label>
      <label class="field">
        <span>Email</span>
        <input
          class="input"
          :value="user?.email"
          readonly
        >
      </label>
      <label class="field !mb-0">
        <span>Company</span>
        <input
          class="input"
          :value="user?.companyName"
          readonly
        >
      </label>
    </div>

    <p class="mt-4 text-sm text-[var(--color-ink-500)]">
      Truck assignment and notification preferences will live here. Profile edits are next.
    </p>
  </section>
</template>
