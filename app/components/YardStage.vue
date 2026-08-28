<script setup lang="ts">
import { EQUIPMENT_LENGTH_FT } from '#shared/utils/domain'
import type { ContainerType, EquipmentType } from '#shared/utils/domain'

export interface YardContainer {
  id: string
  number: string
  numberNormalized?: string | null
  equipmentType: EquipmentType
  containerType: ContainerType
  isLoaded: boolean
  x?: number | null
  y?: number | null
  rotation?: number | null
}

withDefaults(defineProps<{
  locationName: string
  streetLabel?: string | null
  containers: YardContainer[]
}>(), {
  streetLabel: null,
})

const scale = ref(1)

function boxClass(item: YardContainer) {
  const length = EQUIPMENT_LENGTH_FT[item.equipmentType] <= 20 ? 's20' : 's40'
  const paint = item.containerType === 'TROPICAL'
    ? 'teal'
    : item.containerType === 'ZIM' || item.containerType === 'KING_OCEAN'
      ? 'rust'
      : ''
  return [length, paint, item.isLoaded ? '' : 'empty'].filter(Boolean).join(' ')
}

function shortNumber(item: YardContainer) {
  const raw = item.numberNormalized || item.number.replace(/[\s-]/g, '')
  return raw.length > 11 ? raw.slice(0, 11) : raw
}

/**
 * Use recorded yard-plane coordinates when present. Otherwise stack boxes in
 * Row A / Row B so an unmapped yard still looks like the design template.
 */
function boxStyle(item: YardContainer, index: number) {
  if (item.x != null && item.y != null) {
    return {
      left: `${item.x}px`,
      top: `${item.y}px`,
      transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined,
    }
  }

  const col = index % 3
  const row = Math.floor(index / 3)
  const empty = !item.isLoaded
  return {
    left: `${30 + col * 98}px`,
    top: `${(empty ? 276 : 112) + row * 36}px`,
  }
}
</script>

<template>
  <div class="card yard-card">
    <div class="yard-toolbar">
      <b>Operational View · live</b>
      <div class="ybtns">
        <button
          type="button"
          class="ybtn"
          aria-label="Zoom out"
          @click="scale = Math.max(0.7, +(scale - 0.1).toFixed(2))"
        >
          −
        </button>
        <button
          type="button"
          class="ybtn"
          aria-label="Zoom in"
          @click="scale = Math.min(1.6, +(scale + 0.1).toFixed(2))"
        >
          ＋
        </button>
        <button
          type="button"
          class="ybtn"
          aria-label="Reset zoom"
          @click="scale = 1"
        >
          ⟲
        </button>
      </div>
    </div>

    <div class="yard-stage">
      <div
        class="yard-plane"
        :style="{ transform: `scale(${scale})` }"
      >
        <div class="street">
          <span>{{ (streetLabel || locationName).toUpperCase() }}</span>
        </div>
        <div class="sidewalk" />
        <div
          class="gate"
          style="left: 280px; width: 70px"
        />
        <div
          class="fence"
          style="left: 0; right: 380px; top: 66px"
        />
        <div
          class="fence"
          style="left: 350px; right: 0; top: 66px"
        />

        <div
          class="zone"
          style="left: 16px; top: 86px; width: 300px; height: 150px"
        >
          ROW A · LOADED
        </div>
        <div
          class="zone"
          style="left: 16px; top: 250px; width: 300px; height: 120px"
        >
          ROW B · EMPTIES
        </div>
        <div
          class="zone"
          style="left: 336px; top: 86px; width: 170px; height: 284px"
        >
          ROW C
        </div>
        <div
          class="bldg"
          style="left: 530px; top: 330px; width: 112px; height: 82px"
        >
          OFFICE
        </div>
        <div
          class="bldg"
          style="left: 530px; top: 250px; width: 112px; height: 60px"
        >
          SHOP
        </div>

        <NuxtLink
          v-for="(item, index) in containers"
          :key="item.id"
          :to="`/containers/${item.id}`"
          class="cbox"
          :class="boxClass(item)"
          :style="boxStyle(item, index)"
        >
          {{ shortNumber(item) }}
        </NuxtLink>
      </div>
    </div>

    <div class="map-hint">
      Position, angle and door direction are recorded exactly as placed. Tap a container for its current service life.
    </div>
    <div class="legend">
      <span>
        <i style="background: linear-gradient(180deg, #2A4a6b, #1D3A57)" />
        Loaded
      </span>
      <span>
        <i style="background: #F2F4F1; border: 1.5px dashed var(--color-ink-400)" />
        Empty
      </span>
      <span>
        <i style="background: var(--color-amber-500); width: 5px" />
        Door end
      </span>
    </div>
  </div>
</template>
