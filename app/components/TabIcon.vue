<script setup lang="ts">
export type TabIconName = 'home' | 'trips' | 'containers' | 'more'

defineProps<{ name: TabIconName }>()
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    width="22"
    height="22"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <template v-if="name === 'home'">
      <path d="M4.4 11.2 12 4.6l7.6 6.6" />
      <path d="M6.4 10.3V20h4.1v-5.4h3V20h4.1V10.3" />
    </template>

    <template v-else-if="name === 'trips'">
      <circle
        cx="6.4"
        cy="17.7"
        r="2.35"
      />
      <circle
        cx="17.6"
        cy="6.3"
        r="2.35"
      />
      <path d="M8.6 17.7h6.4a3.3 3.3 0 0 0 0-6.6H9.2a3.3 3.3 0 0 1 0-6.6H15" />
    </template>

    <template v-else-if="name === 'containers'">
      <rect
        x="3.4"
        y="5.8"
        width="17.2"
        height="12.4"
        rx="1.4"
      />
      <path d="M8.2 5.8v12.4M12 5.8v12.4M15.8 5.8v12.4" />
    </template>

    <template v-else>
      <rect
        x="3.4"
        y="3.4"
        width="7.2"
        height="7.2"
        rx="1.4"
      />
      <rect
        x="13.4"
        y="3.4"
        width="7.2"
        height="7.2"
        rx="1.4"
      />
      <rect
        x="3.4"
        y="13.4"
        width="7.2"
        height="7.2"
        rx="1.4"
      />
      <rect
        x="13.4"
        y="13.4"
        width="7.2"
        height="7.2"
        rx="1.4"
      />
    </template>
  </svg>
</template>
