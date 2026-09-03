<script setup lang="ts">
import { BRAND_LOADER_MIN_MS } from '~/composables/useBrandLoader'

const { open, leaving, caption } = useBrandLoader()
const label = computed(() => caption.value || 'Saving')
</script>

<template>
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
      <p class="brand-loader-caption">
        {{ label }}
      </p>
      <div
        class="brand-loader-bar"
        role="progressbar"
        :aria-label="label"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <span
          class="brand-loader-bar-fill"
          :style="{ animationDuration: `${BRAND_LOADER_MIN_MS}ms` }"
        />
      </div>
      <span class="sr-only">{{ label }}</span>
    </div>
  </div>
</template>
