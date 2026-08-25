<script setup lang="ts">
const { appName } = useRuntimeConfig().public
</script>

<template>
  <div class="flex min-h-dvh flex-col">
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
    <main class="mx-auto flex w-full max-w-[440px] flex-1 flex-col px-4 py-8">
      <div class="my-auto w-full">
        <slot />
      </div>
    </main>

    <footer class="px-4 pb-8 text-center text-xs text-[var(--color-ink-400)]">
      <p>Driver Portal</p>
      <p class="mt-1">
        Created by
        <a
          class="font-bold text-[var(--color-blue-500)] no-underline"
          href="https://github.com/zodyking"
          target="_blank"
          rel="noopener noreferrer"
        >Brandon King</a>
      </p>
    </footer>
  </div>
</template>
