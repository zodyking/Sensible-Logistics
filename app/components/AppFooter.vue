<script setup lang="ts">
/**
 * Viewport-locked credit bar. Teleported to `body` so a dvh-tall column
 * cannot drag it down the page the way the driver tab bar used to.
 */
</script>

<template>
  <Teleport to="body">
    <footer class="app-footer">
      <p>Driver Portal</p>
      <p class="app-footer-by">
        Created by
        <a
          class="app-footer-link"
          href="https://github.com/zodyking"
          target="_blank"
          rel="noopener noreferrer"
        >Brandon King</a>
      </p>
    </footer>
  </Teleport>
</template>
