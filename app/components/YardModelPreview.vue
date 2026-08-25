<script setup lang="ts">
import type { YardModel } from '#shared/utils/yard-model'

const props = defineProps<{
  model: YardModel | null
  locationName?: string
}>()

function flip(model: YardModel, y: number, height = 0) {
  return model.planeHeight - y - height
}

function pathPoints(model: YardModel, path: Array<[number, number]>) {
  return path.map(([x, y]) => `${x},${flip(model, y)}`).join(' ')
}

const caption = computed(() => {
  if (!props.model) return 'Draw a boundary first'
  const bits = [`${props.model.placedSlots} slots`, `${Math.round(props.model.planeWidth)}×${Math.round(props.model.planeHeight)} m`]
  if (props.model.streetCount) bits.push(`${props.model.streetCount} street${props.model.streetCount === 1 ? '' : 's'}`)
  if (props.model.sidewalkCount) bits.push(`${props.model.sidewalkCount} sidewalk${props.model.sidewalkCount === 1 ? '' : 's'}`)
  return bits.join(' · ')
})

const streetStroke = computed(() => Math.max(3.5, (props.model?.planeWidth ?? 80) * 0.01))
const sidewalkStroke = computed(() => Math.max(2, (props.model?.planeWidth ?? 80) * 0.0055))
const walkStroke = computed(() => Math.max(1.6, (props.model?.planeWidth ?? 80) * 0.004))
</script>

<template>
  <div class="card overflow-hidden">
    <div class="flex items-center justify-between border-b border-[var(--color-line-200)] px-4 py-3">
      <b class="font-[family-name:var(--font-display)] text-sm">
        {{ locationName || 'Yard model' }}
      </b>
      <span class="text-xs text-[var(--color-ink-500)]">
        {{ caption }}
      </span>
    </div>

    <div
      v-if="model"
      class="bg-[#E7ECE8] p-3"
    >
      <svg
        :viewBox="`0 0 ${model.planeWidth} ${model.planeHeight}`"
        class="h-56 w-full"
        role="img"
        :aria-label="`Top-down model with ${model.placedSlots} container slots`"
      >
        <rect
          :width="model.planeWidth"
          :height="model.planeHeight"
          fill="#D5DDD7"
        />
        <g
          v-for="(obj, index) in model.objects"
          :key="`${obj.type}-${index}`"
        >
          <polyline
            v-if="obj.path?.length && obj.kind === 'sidewalk'"
            :points="pathPoints(model, obj.path)"
            fill="none"
            stroke="#E8D9B0"
            :stroke-width="sidewalkStroke"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <polyline
            v-else-if="obj.path?.length && (obj.kind === 'footway')"
            :points="pathPoints(model, obj.path)"
            fill="none"
            stroke="#C4B48A"
            :stroke-width="walkStroke"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <polyline
            v-else-if="obj.path?.length"
            :points="pathPoints(model, obj.path)"
            fill="none"
            stroke="#5C6670"
            :stroke-width="streetStroke"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <rect
            v-else-if="obj.type === 'ROAD'"
            :x="obj.x"
            :y="flip(model, obj.y, obj.height)"
            :width="obj.width"
            :height="obj.height"
            fill="#5C6670"
          />
          <rect
            v-else-if="obj.type === 'FENCE'"
            :x="0.6"
            :y="0.6"
            :width="model.planeWidth - 1.2"
            :height="model.planeHeight - 1.2"
            fill="none"
            stroke="#1F3A52"
            stroke-width="1.2"
          />
          <rect
            v-else-if="obj.type === 'GATE'"
            :x="obj.x"
            :y="flip(model, obj.y, obj.height)"
            :width="obj.width"
            :height="obj.height"
            fill="#F0A422"
          />
          <rect
            v-else-if="obj.type === 'BUILDING'"
            :x="obj.x"
            :y="flip(model, obj.y, obj.height)"
            :width="obj.width"
            :height="obj.height"
            fill="#3E4A52"
          />
          <rect
            v-else-if="obj.type === 'SLOT'"
            :x="obj.x"
            :y="flip(model, obj.y, obj.height)"
            :width="obj.width"
            :height="obj.height"
            fill="#245C7A"
            stroke="#0C1E30"
            stroke-width="0.15"
          />
        </g>
      </svg>
    </div>
    <div
      v-else
      class="grid h-40 place-items-center text-sm text-[var(--color-ink-500)]"
    >
      Set the address and boundary to generate the 2D yard.
    </div>
  </div>
</template>
