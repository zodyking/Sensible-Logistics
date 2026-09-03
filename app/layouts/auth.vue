<script setup lang="ts">
/**
 * Signed-out shell — brand bar, scrolling form column, and a credit footer
 * that is layout chrome (not page content). The shell is locked to the
 * layout viewport (`inset: 0`); only `.auth-main` scrolls.
 */
import { resolveProductName } from '#shared/utils/brand'

const appName = computed(() => resolveProductName(useRuntimeConfig().public.appName))
</script>

<template>
  <div class="auth-app">
    <header class="d-topbar !relative">
      <div class="brand">
        <b>{{ appName }}</b>
        <i
          class="brand-rule"
          aria-hidden="true"
        />
      </div>
    </header>

    <!-- `my-auto` centers short forms in the viewport but yields to tall ones,
         so the signup form never overflows past the top edge. -->
    <div class="auth-stage">
      <main class="auth-main">
        <div class="auth-main-inner">
          <slot />
        </div>
      </main>
      <BrandLoader />
    </div>

    <AppFooter />
  </div>
</template>
