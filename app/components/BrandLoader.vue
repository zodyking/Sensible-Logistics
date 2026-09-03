<script setup lang="ts">
const { open, leaving, caption } = useBrandLoader()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="brand-loader"
      :class="{ leaving }"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div class="brand-loader-stage">
        <span
          class="brand-loader-glow"
          aria-hidden="true"
        />
        <BrandLogo />
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
