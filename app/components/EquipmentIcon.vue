<script setup lang="ts">
/**
 * Side-view equipment silhouettes for the pickup wizard: the driver reads the
 * rig shape before the words. Corrugation ribs separate a container from a
 * plain trailer, and the bare rail reads as a chassis with no box on it.
 */
export type EquipmentIconName = 'container' | 'chassis' | 'trailer' | 'bobtail'

const props = withDefaults(defineProps<{ name: EquipmentIconName, size?: number }>(), {
  size: 40,
})

const hasRail = computed(() => props.name !== 'bobtail')
</script>

<template>
  <svg
    :width="size"
    :height="size / 2"
    viewBox="0 0 64 32"
    fill="currentColor"
    aria-hidden="true"
  >
    <!-- Tractor: cab, sloped nose, hood -->
    <path d="M39.5 22.4V9h9.4l4.2 5.6h4.4v7.8Z" />
    <rect
      x="37"
      y="22.4"
      width="21"
      height="1.8"
      rx="0.9"
    />
    <circle
      cx="44.2"
      cy="25.4"
      r="3.4"
    />
    <circle
      cx="54.2"
      cy="25.4"
      r="3.4"
    />

    <!-- Chassis rail and rear bogie -->
    <template v-if="hasRail">
      <rect
        x="3"
        y="22.4"
        width="37"
        height="1.8"
        rx="0.9"
      />
      <circle
        cx="10.6"
        cy="25.4"
        r="3.1"
      />
      <circle
        cx="17.6"
        cy="25.4"
        r="3.1"
      />
    </template>

    <!-- Box on the rail -->
    <rect
      v-if="name === 'trailer'"
      x="3.5"
      y="6.6"
      width="33"
      height="15.2"
      rx="1.4"
    />

    <template v-if="name === 'container'">
      <rect
        x="4.5"
        y="7.6"
        width="31"
        height="13.2"
        rx="1.2"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      />
      <path
        d="M9.5 10.4v7.6M13.8 10.4v7.6M18.1 10.4v7.6M22.4 10.4v7.6M26.7 10.4v7.6M31 10.4v7.6"
        stroke="currentColor"
        stroke-width="1.5"
      />
    </template>

    <!-- A bare chassis shows the pin plate where a box would sit -->
    <rect
      v-if="name === 'chassis'"
      x="3"
      y="19.4"
      width="26"
      height="1.6"
      rx="0.8"
    />
  </svg>
</template>
