<script setup lang="ts">
definePageMeta({ layout: 'admin' })
useHead({ title: 'Inventory · Management' })
</script>

<template>
  <div>
    <div class="a-head">
      <div>
        <span class="eyebrow">Operations</span>
        <h1>Inventory</h1>
      </div>
      <NuxtLink
        to="/locations/new?returnTo=/admin/inventory"
        class="btn-dark w-auto"
      >
        ＋ New location
      </NuxtLink>
    </div>

    <AdminInventoryLocations />
  </div>
</template>
