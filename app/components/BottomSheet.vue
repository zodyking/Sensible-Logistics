<script setup lang="ts">
defineProps<{
  open: boolean
  title: string
}>()

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="sheet-overlay"
      @click.self="emit('close')"
    >
      <div
        class="sheet"
        role="dialog"
        aria-modal="true"
      >
        <div
          class="sheet-grab"
          aria-hidden="true"
        />
        <h2>{{ title }}</h2>
        <slot />
      </div>
    </div>
  </Teleport>
</template>
