<script setup lang="ts">
import { CONTAINER_TYPE_LABELS, CONTAINER_TYPE_PAINT, type ContainerType, type ContainerTypeCounts } from '#shared/utils/domain'

const TYPE_ORDER = ['KING_OCEAN', 'TROPICAL', 'CMA', 'ZIM'] as const satisfies readonly ContainerType[]

defineProps<{
  counts: ContainerTypeCounts
  occupancy?: number
}>()
</script>

<template>
  <ul
    class="type-counts"
    :aria-label="occupancy != null ? `${occupancy} containers on site` : 'Containers by type'"
  >
    <li
      v-for="type in TYPE_ORDER"
      :key="type"
      :class="{ dim: counts[type] === 0 }"
    >
      <i
        aria-hidden="true"
        :style="{ background: CONTAINER_TYPE_PAINT[type].fill }"
      />
      <span>{{ CONTAINER_TYPE_LABELS[type] }}</span>
      <b>{{ counts[type] }}</b>
    </li>
  </ul>
</template>
