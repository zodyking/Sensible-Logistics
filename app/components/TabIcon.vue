<script setup lang="ts">
export type TabIconName = 'home' | 'trips' | 'containers' | 'more' | 'tasks'

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
      <g stroke-width="1.8">
        <rect
          x="3.4"
          y="4"
          width="17.2"
          height="16"
          rx="1.3"
        />
        <path d="M3.4 6.6h17.2" />
        <path d="M12 6.6v13.4" />
        <path d="M7.7 8.4v9.6" />
        <path d="M16.3 8.4v9.6" />
        <path d="M6.6 13.2h2.2" />
        <path d="M15.2 13.2h2.2" />
      </g>
    </template>

    <template v-else-if="name === 'tasks'">
      <path d="M9.2 6.2h10.4" />
      <path d="M9.2 12h10.4" />
      <path d="M9.2 17.8h10.4" />
      <path d="M4.2 6.2l1.4 1.4 2.4-2.8" />
      <path d="M4.2 12l1.4 1.4 2.4-2.8" />
      <path d="M4.2 17.8l1.4 1.4 2.4-2.8" />
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
