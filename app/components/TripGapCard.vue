<script setup lang="ts">
import type { GapResolution, TripGap } from '#shared/utils/trip-gaps'

const props = defineProps<{
  gap: TripGap
  resolution?: GapResolution | null
}>()

const emit = defineEmits<{
  resolve: [resolution: GapResolution]
}>()

const confirmed = computed(() => props.resolution === 'BOBTAIL')
const menuOpen = ref(false)
const busy = ref(false)

async function choose(resolution: GapResolution) {
  if (busy.value) return
  busy.value = true
  menuOpen.value = false
  try {
    emit('resolve', resolution)
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <article
    class="trip-move trip-gap is-static"
    :class="confirmed ? 'bobtail' : 'warn'"
  >
    <span
      class="trip-move-rail"
      aria-hidden="true"
    />
    <div class="trip-gap-body">
      <div class="trip-gap-tools">
        <StatusChip
          v-if="!confirmed"
          variant="warn"
          label="Missing"
        />
        <button
          v-if="confirmed"
          type="button"
          class="icon-btn"
          aria-label="Bobtail actions"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
          :disabled="busy"
          @click="menuOpen = true"
        >
          ⋮
        </button>
      </div>

      <div class="trip-gap-core">
        <BobtailMark :size="confirmed ? 52 : 44" />
        <p class="trip-gap-title">
          {{ confirmed ? 'Bobtail' : 'Missing trip' }}
        </p>
        <p class="trip-move-route">
          <span>{{ gap.fromName }}</span>
          <span
            class="trip-move-arrow"
            aria-hidden="true"
          />
          <span class="to">{{ gap.toName }}</span>
        </p>
      </div>

      <button
        v-if="!confirmed"
        type="button"
        class="btn-dark trip-gap-confirm"
        :disabled="busy"
        @click="choose('BOBTAIL')"
      >
        Yes, I made a bobtail move
      </button>
    </div>

    <BottomSheet
      :open="menuOpen"
      title="Bobtail"
      @close="menuOpen = false"
    >
      <button
        type="button"
        class="menu-row"
        :disabled="busy"
        @click="choose('MISSING')"
      >
        This was not a bobtail
      </button>
    </BottomSheet>
  </article>
</template>
