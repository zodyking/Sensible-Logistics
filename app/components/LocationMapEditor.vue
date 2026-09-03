<script setup lang="ts">
import type { GeoJsonPolygon } from '#shared/utils/geo'
import { bboxFromPolygon, headingDelta, normalizeHeading } from '#shared/utils/geo'
import { isPlacedPin } from '#shared/utils/yard-slots'
import { loadLeaflet, observeMapSize, waitForMapSize } from '~/utils/leaflet-map'
import { ESRI_ATTRIBUTION, ESRI_SATELLITE_URL, OSM_ATTRIBUTION, osmTileUrl } from '~/utils/map-tiles'

const props = withDefaults(defineProps<{
  latitude: number | null
  longitude: number | null
  boundary: GeoJsonPolygon | null
  heading?: number
}>(), {
  heading: 0,
})

const emit = defineEmits<{
  'update:boundary': [GeoJsonPolygon]
  'update:heading': [value: number]
}>()

const mapEl = ref<HTMLElement | null>(null)
const ready = ref(false)
const errorMessage = ref('')
const satellite = ref(true)

type LeafletModule = typeof import('leaflet')
let L: LeafletModule | null = null
let map: import('leaflet').Map | null = null
let fenceLayer: import('leaflet').Polygon | null = null
let pinMarker: import('leaflet').Marker | null = null
let osmLayer: import('leaflet').TileLayer | null = null
let satLayer: import('leaflet').TileLayer | null = null
let cancelled = false
let stopSizeWatch: (() => void) | null = null
let applyingHeading = false

/** Fraction of the viewport left as margin around the captured fence. */
const FRAME_INSET = 0.12

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

function paintFence() {
  if (!map || !L) return
  fenceLayer?.remove()
  fenceLayer = null
  const ring = props.boundary?.coordinates?.[0]
  if (!ring?.length) return
  fenceLayer = L.polygon(ring.map(([lng, lat]) => [lat, lng] as [number, number]), {
    color: '#F0A422',
    weight: 2,
    fillColor: '#F0A422',
    fillOpacity: 0.14,
    interactive: false,
  }).addTo(map)
}

function setTileLayer(useSatellite: boolean) {
  if (!map) return
  satellite.value = useSatellite
  if (useSatellite) {
    osmLayer?.remove()
    satLayer?.addTo(map)
  }
  else {
    satLayer?.remove()
    osmLayer?.addTo(map)
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

function setInitialView() {
  if (!map) return
  const box = bboxFromPolygon(props.boundary)
  if (box) {
    map.fitBounds(
      [[box.south, box.west], [box.north, box.east]],
      { animate: false, padding: [40, 40], maxZoom: 19 },
    )
    return
  }
  if (isPlacedPin(props.latitude, props.longitude)) {
    map.setView([props.latitude!, props.longitude!], 18, { animate: false })
    return
  }
  map.setView([39.8283, -98.5795], 4, { animate: false })
}

/**
 * The fence is whatever sits inside the on-screen frame. With the map rotated
 * to the street this yields a quad that hugs the roadway, not a north-up box.
 */
function captureFence(): GeoJsonPolygon | null {
  if (!map || !L) return null
  const size = map.getSize()
  if (!size.x || !size.y) return null
  const ix = size.x * FRAME_INSET
  const iy = size.y * FRAME_INSET
  const corners: Array<[number, number]> = [
    [ix, iy],
    [size.x - ix, iy],
    [size.x - ix, size.y - iy],
    [ix, size.y - iy],
  ]
  const ring = corners.map(([x, y]) => {
    const latlng = map!.containerPointToLatLng(L!.point(x, y))
    return [latlng.lng, latlng.lat] as [number, number]
  })
  ring.push(ring[0]!)
  const polygon: GeoJsonPolygon = { type: 'Polygon', coordinates: [ring] }
  emit('update:boundary', polygon)
  return polygon
}

async function boot() {
  if (!import.meta.client || !mapEl.value) return
  try {
    const sized = await waitForMapSize(mapEl.value, () => cancelled)
    if (cancelled || !mapEl.value) return
    if (!sized) {
      errorMessage.value = 'Map did not get a size. Go back one step and open it again.'
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
    satLayer = L.tileLayer(ESRI_SATELLITE_URL, {
      maxZoom: 22,
      attribution: ESRI_ATTRIBUTION,
    })
    osmLayer = L.tileLayer(osmTileUrl(), {
      maxZoom: 22,
      attribution: OSM_ATTRIBUTION,
    })
    if (satellite.value) satLayer.addTo(map)
    else osmLayer.addTo(map)
    map.on('rotate', onRotate)
    setInitialView()
    paintFence()
    paintPin()
    ready.value = true
    map.invalidateSize()
    applyHeading(props.heading)
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

watch(() => props.boundary, () => {
  if (!ready.value) return
  paintFence()
})
watch(() => [props.latitude, props.longitude] as const, () => {
  if (!ready.value) return
  paintPin()
  setInitialView()
})
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
    pinMarker?.remove()
    fenceLayer?.remove()
    osmLayer?.remove()
    satLayer?.remove()
    map?.remove()
  }
  catch {
    // Leaflet throws if the pane was already detached during a route change.
  }
  map = null
  fenceLayer = null
  pinMarker = null
  osmLayer = null
  satLayer = null
  L = null
})

defineExpose({
  captureFence,
  recenter: setInitialView,
})
</script>

<template>
  <div>
    <div class="map-frame-wrap">
      <div
        ref="mapEl"
        class="location-map place"
        role="application"
        aria-label="OpenStreetMap. Rotate and pan until the yard fills the frame, then set the fence."
      />
      <div
        class="fence-frame"
        aria-hidden="true"
      />
    </div>
    <div
      v-if="ready"
      class="tile-toggle"
    >
      <button
        type="button"
        :class="['tile-btn', { active: satellite }]"
        @click="setTileLayer(true)"
      >
        Satellite
      </button>
      <button
        type="button"
        :class="['tile-btn', { active: !satellite }]"
        @click="setTileLayer(false)"
      >
        Map
      </button>
    </div>

    <p
      v-if="errorMessage"
      class="banner err mt-2 mb-0"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ errorMessage }}</span>
    </p>
    <button
      type="button"
      class="btn-dark mt-3 w-full"
      :disabled="!ready"
      @click="captureFence"
    >
      {{ boundary ? 'Update fence to this view' : 'Set fence to this view' }}
    </button>
    <p class="field-hint mt-2">
      Align to the road on the aerial photo, then pan and zoom until the yard fills
      the gold frame.
    </p>
  </div>
</template>
