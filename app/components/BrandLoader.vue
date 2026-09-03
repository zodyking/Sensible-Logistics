<script setup lang="ts">
const { open, caption } = useBrandLoader()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="brand-loader"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div class="brand-loader-panel">
        <BrandLogo />
        <span
          class="brand-loader-bar"
          aria-hidden="true"
        >
          <i />
        </span>
        <p
          v-if="caption"
          class="brand-loader-caption"
        >
          {{ caption }}
        </p>
        <span class="sr-only">{{ caption || 'Loading' }}</span>
      </div>
    </div>
  </Teleport>
</template>
