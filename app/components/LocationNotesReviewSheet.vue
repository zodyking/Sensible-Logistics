<script setup lang="ts">
const props = defineProps<{
  open: boolean
  notes: Array<{
    id: string
    body: string
    authorName: string
    createdAt: string | Date
  }>
  index: number
}>()

const emit = defineEmits<{
  close: []
  back: []
  next: []
}>()

const current = computed(() => props.notes[props.index] ?? null)
const total = computed(() => props.notes.length)
const last = computed(() => total.value > 0 && props.index >= total.value - 1)
const title = computed(() => (
  total.value > 1 ? `Note ${props.index + 1} of ${total.value}` : 'Note'
))
</script>

<template>
  <BottomSheet
    :open="open && Boolean(current)"
    :title="title"
    @close="emit('close')"
  >
    <article
      v-if="current"
      class="loc-note loc-note-review"
    >
      <p class="loc-note-body">
        {{ current.body }}
      </p>
      <div class="loc-note-meta">
        <span>{{ current.authorName }} · {{ formatRelative(current.createdAt) }}</span>
      </div>
    </article>
    <div class="sheet-actions">
      <button
        v-if="total > 1"
        type="button"
        class="btn-cancel"
        :disabled="index <= 0"
        @click="emit('back')"
      >
        Back
      </button>
      <button
        v-else
        type="button"
        class="btn-cancel"
        @click="emit('close')"
      >
        Close
      </button>
      <button
        type="button"
        class="btn-save"
        @click="last ? emit('close') : emit('next')"
      >
        {{ last ? 'Done' : 'Next' }}
      </button>
    </div>
  </BottomSheet>
</template>
