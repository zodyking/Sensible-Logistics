<script setup lang="ts">
import type { LocationType } from '#shared/utils/domain'

/**
 * Location-type marks for lists and pickers. Each silhouette is a different
 * shape so a driver can tell a yard from a customer from a port or rail gate
 * without reading the label.
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
    <!-- Warehouse: peaked roof, roll door -->
    <template v-if="name === 'COMPANY_YARD'">
      <path d="M4 14.2 16 6.4 28 14.2v1.8H4Z" />
      <path d="M6.2 16.4h19.6V26H6.2Z" />
      <rect
        x="12.4"
        y="19.2"
        width="7.2"
        height="6.8"
        rx="0.6"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
      />
      <path
        d="M13.6 21.2h4.8M13.6 23.2h4.8M13.6 25.2h4.8"
        stroke="currentColor"
        stroke-width="1.2"
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
