<script setup lang="ts">
withDefaults(defineProps<{
  size?: number
}>(), {
  size: 52,
})
</script>

<template>
  <span
    class="bobtail-mark"
    :style="{ width: `${size}px`, height: `${size}px` }"
    aria-hidden="true"
  >
    <svg
      viewBox="0 0 64 64"
      width="70%"
      height="70%"
      fill="none"
    >
      <!-- Cab body -->
      <path
        d="M18 36.5V22.2c0-1.4 1.1-2.5 2.5-2.5H36l7.2 8.4H49c1.3 0 2.4 1.1 2.4 2.4v6Z"
        fill="currentColor"
      />
      <!-- Hood / bumper -->
      <path
        d="M49 30.1h4.2c1.2 0 2.2 1 2.2 2.2v4.2H49V30.1Z"
        fill="currentColor"
      />
      <!-- Windshield -->
      <path
        d="M22 22.4h12.6l4.8 6.2H22V22.4Z"
        fill="#fff"
        opacity="0.35"
      />
      <!-- Fifth-wheel plate, no trailer -->
      <rect
        x="10"
        y="35.2"
        width="12"
        height="2.4"
        rx="1.2"
        fill="currentColor"
      />
      <circle
        cx="13.2"
        cy="36.4"
        r="1.3"
        fill="#fff"
        opacity="0.4"
      />
      <!-- Wheels -->
      <circle
        cx="24.2"
        cy="43.2"
        r="5.1"
        fill="currentColor"
      />
      <circle
        cx="24.2"
        cy="43.2"
        r="2.1"
        fill="#fff"
        opacity="0.35"
      />
      <circle
        cx="45.6"
        cy="43.2"
        r="5.1"
        fill="currentColor"
      />
      <circle
        cx="45.6"
        cy="43.2"
        r="2.1"
        fill="#fff"
        opacity="0.35"
      />
    </svg>
  </span>
</template>
