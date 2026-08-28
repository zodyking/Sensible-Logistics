<script setup lang="ts">
import type { BoundingBox } from '#shared/utils/geo'
import { headingDelta, isValidBbox, normalizeHeading } from '#shared/utils/geo'
import { isPlacedPin } from '#shared/utils/yard-slots'
import { loadLeaflet, observeMapSize, waitForMapSize } from '~/utils/leaflet-map'
import { OSM_ATTRIBUTION, osmTileUrl } from '~/utils/map-tiles'

const props = withDefaults(defineProps<{
  latitude: number | null
  longitude: number | null
  bbox: BoundingBox | null
  heading?: number
}>(), {
  heading: 0,
})

const emit = defineEmits<{
  'update:bbox': [BoundingBox]
  'update:heading': [value: number]
}>()

const mapEl = ref<HTMLElement | null>(null)
const ready = ref(false)
const errorMessage = ref('')

type LeafletModule = typeof import('leaflet')
let L: LeafletModule | null = null
let map: import('leaflet').Map | null = null
let rectangle: import('leaflet').Rectangle | null = null
let pinMarker: import('leaflet').Marker | null = null
const corners: import('leaflet').Marker[] = []
let cancelled = false
let stopSizeWatch: (() => void) | null = null
let applyingHeading = false

function hasStart() {
  return Boolean(props.bbox) || isPlacedPin(props.latitude, props.longitude)
}

function startBox(): BoundingBox | null {
  if (props.bbox && isValidBbox(props.bbox)) return props.bbox
  if (isPlacedPin(props.latitude, props.longitude)) {
    return {
      west: props.longitude! - 0.0008,
      east: props.longitude! + 0.0008,
      south: props.latitude! - 0.0008,
      north: props.latitude! + 0.0008,
    }
  }
  return null
}

function asLatLngBounds(box: BoundingBox) {
  return L!.latLngBounds(
    L!.latLng(box.south, box.west),
    L!.latLng(box.north, box.east),
  )
}

function paintPin() {
  if (!map || !L) return
  pinMarker?.remove()
  pinMarker = null
  if (!isPlacedPin(props.latitude, props.longitude)) return
  pinMarker = L.marker([props.latitude!, props.longitude!], {
    icon: L.divIcon({
      className: 'addr-pin',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    }),
    interactive: false,
    keyboard: false,
    zIndexOffset: 400,
  }).addTo(map)
}

function paintCorners(box: BoundingBox) {
  if (!map || !L) return
  const points: Array<[number, number]> = [
    [box.south, box.west],
    [box.south, box.east],
    [box.north, box.east],
    [box.north, box.west],
  ]
  const icon = L.divIcon({
    className: 'bbox-handle',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
  while (corners.length < 4) {
    const marker = L.marker(points[corners.length]!, { draggable: true, icon, zIndexOffset: 600 })
    marker.on('drag', () => {
      if (!rectangle || corners.length < 4) return
      const lats = corners.map(m => m.getLatLng().lat)
      const lngs = corners.map(m => m.getLatLng().lng)
      const next = {
        west: Math.min(...lngs),
        east: Math.max(...lngs),
        south: Math.min(...lats),
        north: Math.max(...lats),
      }
      if (!isValidBbox(next)) return
      rectangle.setBounds(asLatLngBounds(next))
      emit('update:bbox', next)
    })
    marker.addTo(map)
    corners.push(marker)
  }
  corners.forEach((marker, i) => marker.setLatLng(points[i]!))
}

function applyBox(box: BoundingBox, fit: boolean) {
  if (!map || !L || !isValidBbox(box)) return
  const bounds = asLatLngBounds(box)
  if (!rectangle) {
    rectangle = L.rectangle(bounds, {
      color: '#F0A422',
      weight: 2,
      fillColor: '#F0A422',
      fillOpacity: 0.18,
    }).addTo(map)
  }
  else {
    rectangle.setBounds(bounds)
  }
  paintCorners(box)
  paintPin()
  if (fit) {
    map.fitBounds(
      [[box.south, box.west], [box.north, box.east]],
      { animate: false, padding: [28, 28], maxZoom: 19 },
    )
  }
}

function applyHeading(value: number) {
  if (!map) return
  applyingHeading = true
  map.setBearing(normalizeHeading(value))
  applyingHeading = false
}

function onRotate() {
  if (!map || applyingHeading) return
  const next = normalizeHeading(map.getBearing())
  if (headingDelta(next, props.heading) < 0.4) return
  emit('update:heading', next)
}

async function boot() {
  if (!import.meta.client || !mapEl.value || !hasStart()) return
  try {
    const sized = await waitForMapSize(mapEl.value, () => cancelled)
    if (cancelled || !mapEl.value || !sized) {
      if (!cancelled && mapEl.value) {
        errorMessage.value = 'Map did not get a size. Go back one step and open it again.'
      }
      return
    }
    L = await loadLeaflet()
    if (cancelled || !mapEl.value) return
    map = L.map(mapEl.value, {
      zoomControl: true,
      attributionControl: true,
      rotate: true,
      bearing: normalizeHeading(props.heading),
      touchRotate: true,
      rotateControl: false,
      shiftKeyRotate: true,
    })
    L.tileLayer(osmTileUrl(), {
      maxZoom: 22,
      attribution: OSM_ATTRIBUTION,
    }).addTo(map)
    map.on('rotate', onRotate)

    const start = startBox()
    if (start) {
      map.setView([(start.north + start.south) / 2, (start.west + start.east) / 2], 17)
      applyBox(start, false)
      if (!props.bbox) emit('update:bbox', start)
    }
    ready.value = true
    map.invalidateSize()
    applyHeading(props.heading)
    if (start) applyBox(start, true)
    stopSizeWatch = observeMapSize(mapEl.value, () => {
      if (cancelled || !map) return
      map.invalidateSize()
    })
  }
  catch (error) {
    if (!cancelled) {
      errorMessage.value = error instanceof Error ? error.message : 'Map failed to load.'
    }
  }
}

function useVisibleMap() {
  if (!map) return
  const bounds = map.getBounds()
  const box = {
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth(),
  }
  if (!isValidBbox(box)) return
  applyBox(box, false)
  emit('update:bbox', box)
}

watch(
  () => [props.latitude, props.longitude, props.bbox] as const,
  async () => {
    if (!hasStart()) return
    if (!ready.value) {
      await boot()
      return
    }
    const box = startBox()
    if (box) applyBox(box, true)
  },
)

watch(() => props.heading, (value) => {
  if (!ready.value || !map) return
  if (headingDelta(map.getBearing(), value) < 0.4) return
  applyHeading(value)
})

onMounted(() => {
  cancelled = false
  boot()
})
onBeforeUnmount(() => {
  cancelled = true
  stopSizeWatch?.()
  stopSizeWatch = null
  try {
    map?.off()
    for (const marker of corners) marker.remove()
    pinMarker?.remove()
    rectangle?.remove()
    map?.remove()
  }
  catch {
    // Leaflet throws if the pane was already detached during a route change.
  }
  map = null
  rectangle = null
  pinMarker = null
  corners.length = 0
  L = null
})

defineExpose({
  recenter() {
    const box = startBox()
    if (box) applyBox(box, true)
  },
})
</script>

<template>
  <div>
    <div
      v-if="!hasStart()"
      class="location-map flex items-center justify-center p-6 text-center text-sm text-[var(--color-ink-500)]"
      role="status"
    >
      Pick a United States address first. The map opens on that pin, not a default city.
    </div>
    <div
      v-else
      ref="mapEl"
      class="location-map"
      role="application"
      aria-label="OpenStreetMap. Drag the gold corners to set the yard boundary."
    />
    <p
      v-if="errorMessage"
      class="banner err mt-2 mb-0"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ errorMessage }}</span>
    </p>
    <div class="mt-2 flex flex-wrap gap-2">
      <button
        type="button"
        class="btn-ghost"
        :disabled="!ready"
        @click="useVisibleMap"
      >
        Use this map view as the boundary
      </button>
    </div>
    <p class="field-hint mt-2">
      Drag the gold handles to draw the operational fence. Rotate the map so the road
      runs straight, then pan until the fence matches the real yard.
    </p>
  </div>
</template>
