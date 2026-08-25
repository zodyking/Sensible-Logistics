<script setup lang="ts">
import type { BoundingBox } from '#shared/utils/geo'
import { isValidBbox } from '#shared/utils/geo'

const props = defineProps<{
  latitude: number | null
  longitude: number | null
  bbox: BoundingBox | null
}>()

const emit = defineEmits<{
  'update:bbox': [BoundingBox]
}>()

const mapEl = ref<HTMLElement | null>(null)
const ready = ref(false)
const errorMessage = ref('')

type LeafletModule = typeof import('leaflet')
let L: LeafletModule | null = null
let map: import('leaflet').Map | null = null
let rectangle: import('leaflet').Rectangle | null = null
const corners: import('leaflet').Marker[] = []

function asLatLngBounds(box: BoundingBox) {
  return L!.latLngBounds(
    L!.latLng(box.south, box.west),
    L!.latLng(box.north, box.east),
  )
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
  if (fit) map.fitBounds(bounds.pad(0.18))
}

async function boot() {
  if (!import.meta.client || !mapEl.value) return
  try {
    L = await import('leaflet')
    await import('leaflet/dist/leaflet.css')
    map = L.map(mapEl.value, {
      zoomControl: true,
      attributionControl: true,
    })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)

    const start = props.bbox
      ?? (props.latitude != null && props.longitude != null
        ? { west: props.longitude - 0.002, east: props.longitude + 0.002, south: props.latitude - 0.002, north: props.latitude + 0.002 }
        : { west: -80.16, east: -80.08, south: 26.05, north: 26.12 })
    map.setView([(start.north + start.south) / 2, (start.west + start.east) / 2], 15)
    applyBox(start, true)
    ready.value = true
    setTimeout(() => map?.invalidateSize(), 80)
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Map failed to load.'
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
  () => [props.latitude, props.longitude] as const,
  () => {
    if (!ready.value || !props.bbox) return
    applyBox(props.bbox, true)
  },
)

onMounted(boot)
onBeforeUnmount(() => {
  map?.remove()
  map = null
  rectangle = null
  corners.length = 0
})
</script>

<template>
  <div>
    <div
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
      Drag the gold handles to draw the operational fence. Pan and zoom the OpenStreetMap
      underlay to match the real yard.
    </p>
  </div>
</template>
