<script setup lang="ts">
definePageMeta({ layout: 'admin' })
useHead({ title: 'Account' })
</script>

<template>
  <div>
    <div class="a-head">
      <div>
        <span class="eyebrow">Account</span>
        <h1>Settings</h1>
      </div>
      <p class="text-sm text-[var(--color-ink-500)]">
        Your name, contact details, and sign-in password.
      </p>
    </div>
    <AccountSettingsForm />
  </div>
</template>
