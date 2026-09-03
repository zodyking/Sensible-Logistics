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
const busy = ref(false)

async function choose(resolution: GapResolution) {
  if (busy.value) return
  busy.value = true
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
    class="trip-move is-static"
    :class="confirmed ? 'bobtail' : 'warn'"
  >
    <span
      class="trip-move-rail"
      aria-hidden="true"
    />
    <div class="trip-move-body">
      <div class="trip-move-top">
        <b :class="{ mono: confirmed }">
          <EquipmentIcon
            v-if="confirmed"
            name="bobtail"
            :size="36"
          />
          <span>{{ confirmed ? 'Bobtail move' : 'Missing Trip Detected' }}</span>
        </b>
        <StatusChip
          :variant="confirmed ? 'idle' : 'warn'"
          :label="confirmed ? 'Bobtail' : 'Missing'"
        />
      </div>
      <p class="trip-move-route">
        <span>{{ gap.fromName }}</span>
        <span
          class="trip-move-arrow"
          aria-hidden="true"
        />
        <span class="to">{{ gap.toName }}</span>
      </p>
      <p class="trip-move-meta">
        {{ confirmed
          ? 'Tractor only · between recorded trips'
          : 'Prior drop-off is not the next pickup. Did you bobtail between these stops?' }}
      </p>
      <div class="trip-gap-actions">
        <button
          v-if="!confirmed"
          type="button"
          class="btn-dark"
          :disabled="busy"
          @click="choose('BOBTAIL')"
        >
          Yes, I made a bobtail move
        </button>
        <button
          v-else
          type="button"
          class="btn-ghost"
          :disabled="busy"
          @click="choose('MISSING')"
        >
          This was not a bobtail
        </button>
      </div>
    </div>
  </article>
</template>
