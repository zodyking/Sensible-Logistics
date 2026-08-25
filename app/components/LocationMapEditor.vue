<script setup lang="ts">
import type { BoundingBox } from '#shared/utils/geo'
import { isValidBbox } from '#shared/utils/geo'
import type { OsmWay } from '#shared/utils/osm-ways'

const props = defineProps<{
  latitude: number | null
  longitude: number | null
  bbox: BoundingBox | null
  ways?: OsmWay[]
  photo?: {
    thumbUrl: string
    imageUrl: string
    attribution: string
  } | null
}>()

const emit = defineEmits<{
  'update:bbox': [BoundingBox]
}>()

const mapEl = ref<HTMLElement | null>(null)
const ready = ref(false)
const errorMessage = ref('')
const basemap = ref<'street' | 'aerial'>('street')

type LeafletModule = typeof import('leaflet')
let L: LeafletModule | null = null
let map: import('leaflet').Map | null = null
let rectangle: import('leaflet').Rectangle | null = null
let streetLayer: import('leaflet').TileLayer | null = null
let aerialLayer: import('leaflet').TileLayer | null = null
let wayLayer: import('leaflet').GeoJSON | null = null
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
      fillOpacity: 0.12,
    }).addTo(map)
  }
  else {
    rectangle.setBounds(bounds)
  }
  paintCorners(box)
  if (fit) map.fitBounds(bounds.pad(0.18))
}

function paintWays(ways: OsmWay[]) {
  if (!map || !L) return
  wayLayer?.remove()
  wayLayer = null
  if (!ways.length) return
  wayLayer = L.geoJSON({
    type: 'FeatureCollection',
    features: ways.map(way => ({
      type: 'Feature' as const,
      properties: { kind: way.kind, name: way.name },
      geometry: {
        type: 'LineString' as const,
        coordinates: way.points.map(p => [p.lon, p.lat]),
      },
    })),
  }, {
    style(feature) {
      const kind = feature?.properties?.kind
      if (kind === 'sidewalk') return { color: '#F4E4B4', weight: 4, opacity: 0.95 }
      if (kind === 'footway') return { color: '#D7C48A', weight: 3, opacity: 0.9 }
      return { color: '#1F3A52', weight: 5, opacity: 0.85 }
    },
  }).addTo(map)
}

function applyBasemap() {
  if (!map || !streetLayer || !aerialLayer) return
  if (basemap.value === 'aerial') {
    map.removeLayer(streetLayer)
    aerialLayer.addTo(map)
  }
  else {
    map.removeLayer(aerialLayer)
    streetLayer.addTo(map)
  }
  if (wayLayer) wayLayer.bringToFront()
  rectangle?.bringToFront()
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
    streetLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)
    aerialLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri',
    })

    const start = props.bbox
      ?? (props.latitude != null && props.longitude != null
        ? { west: props.longitude - 0.002, east: props.longitude + 0.002, south: props.latitude - 0.002, north: props.latitude + 0.002 }
        : { west: -80.16, east: -80.08, south: 26.05, north: 26.12 })
    map.setView([(start.north + start.south) / 2, (start.west + start.east) / 2], 17)
    applyBox(start, true)
    paintWays(props.ways ?? [])
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

watch(() => props.ways, (ways) => {
  if (ready.value) paintWays(ways ?? [])
}, { deep: true })

watch(basemap, applyBasemap)

onMounted(boot)
onBeforeUnmount(() => {
  map?.remove()
  map = null
  rectangle = null
  streetLayer = null
  aerialLayer = null
  wayLayer = null
  corners.length = 0
})
</script>

<template>
  <div>
    <div
      v-if="photo"
      class="street-view"
    >
      <img
        :src="photo.imageUrl || photo.thumbUrl"
        alt="Street-level view of this location"
      >
      <small>{{ photo.attribution }}</small>
    </div>
    <p
      v-else
      class="field-hint mb-2"
    >
      No street-level photo at this fence yet. Streets and sidewalks still draw from OpenStreetMap when they are mapped.
    </p>

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
        :aria-pressed="basemap === 'street'"
        :disabled="!ready"
        @click="basemap = 'street'"
      >
        Street map
      </button>
      <button
        type="button"
        class="btn-ghost"
        :aria-pressed="basemap === 'aerial'"
        :disabled="!ready"
        @click="basemap = 'aerial'"
      >
        Aerial
      </button>
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
      Drag the gold handles to fence the yard. Mapped streets are navy, sidewalks are sand.
    </p>
  </div>
</template>
