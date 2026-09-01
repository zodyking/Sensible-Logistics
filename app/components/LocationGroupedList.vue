<script setup lang="ts" generic="T extends { id: string, type: LocationType, isUncategorized?: boolean }">
import type { LocationType } from '#shared/utils/domain'
import { groupLocationsByType } from '#shared/utils/domain'

const props = defineProps<{
  items: T[]
}>()

const groups = computed(() => groupLocationsByType(props.items))
</script>

<template>
  <template
    v-for="group in groups"
    :key="group.key"
  >
    <span class="wiz-label">{{ group.label }}</span>
    <div class="wiz-group">
      <template
        v-for="item in group.items"
        :key="item.id"
      >
        <slot :item="item" />
      </template>
    </div>
  </template>
</template>
