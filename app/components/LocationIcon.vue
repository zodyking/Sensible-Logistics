<script setup lang="ts">
import type { LocationType } from '#shared/utils/domain'

/**
 * Location-type marks for lists and pickers. Each silhouette is a different
 * shape so a driver can tell a parking-lot yard from a customer, port, or
 * rail gate without reading the label.
 */
withDefaults(defineProps<{
  name: LocationType
  size?: number
}>(), {
  size: 32,
})
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 32 32"
    fill="currentColor"
    aria-hidden="true"
  >
    <!-- Company yard: parking-lot P -->
    <template v-if="name === 'COMPANY_YARD'">
      <rect
        x="3.4"
        y="3.4"
        width="25.2"
        height="25.2"
        rx="4"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      />
      <path
        fill-rule="evenodd"
        d="M11 24.2V7.8h6.7c3.35 0 5.5 2.05 5.5 5.2 0 3.15-2.15 5.2-5.5 5.2H14.15V24.2H11Zm3.15-13.95v4.85h3.3c1.7 0 2.7-1.05 2.7-2.42 0-1.38-1-2.43-2.7-2.43h-3.3Z"
      />
    </template>

    <!-- Customer: small building, door, window -->
    <template v-else-if="name === 'CUSTOMER'">
      <path d="M6 15.4 16 7.6 26 15.4v1.6H6Z" />
      <path d="M8 17.2h16V26H8Z" />
      <rect
        x="13.4"
        y="20.4"
        width="5.2"
        height="5.6"
        rx="0.4"
      />
      <rect
        x="9.6"
        y="19.6"
        width="2.8"
        height="2.8"
        rx="0.3"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
      />
    </template>

    <!-- Marine terminal: hull, cabin, one box on deck -->
    <template v-else-if="name === 'MARINE_TERMINAL'">
      <path d="M4.5 20.2h23l-2.4 5.2H6.9Z" />
      <rect
        x="8"
        y="12.4"
        width="8.4"
        height="7.8"
        rx="0.8"
      />
      <rect
        x="17.6"
        y="8.4"
        width="7.2"
        height="11.8"
        rx="0.8"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
      />
      <path
        d="M19.4 10.8v7.2M21.2 10.8v7.2M23 10.8v7.2"
        stroke="currentColor"
        stroke-width="1.3"
      />
    </template>

    <!-- Rail yard: locomotive cab, boiler, rails -->
    <template v-else>
      <path d="M6 18.6V10.8h7.2l3.2 4.4h8.2v3.4Z" />
      <rect
        x="5.2"
        y="18.6"
        width="21.6"
        height="1.6"
        rx="0.6"
      />
      <circle
        cx="11.2"
        cy="22.6"
        r="2.5"
      />
      <circle
        cx="17.4"
        cy="22.6"
        r="2.5"
      />
      <circle
        cx="23.2"
        cy="22.6"
        r="2.5"
      />
      <path
        d="M4 26.2h24M4 28h24"
        stroke="currentColor"
        stroke-width="1.4"
        fill="none"
      />
    </template>
  </svg>
</template>
