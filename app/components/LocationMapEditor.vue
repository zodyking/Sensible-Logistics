<script setup lang="ts">
import type { GeoJsonPolygon } from '#shared/utils/geo'
import {
  bboxFromPolygon,
  headingDelta,
  isPlausibleYardFence,
  normalizeHeading,
  parsePin,
  polygonFromRing,
} from '#shared/utils/geo'
import { formatAddressSearchQuery } from '#shared/utils/us-address'
import { loadLeaflet, observeMapSize, waitForMapSize } from '~/utils/leaflet-map'
import {
  LABELS_ATTRIBUTION,
  LABELS_TILE_URL,
  OSM_ATTRIBUTION,
  osmTileUrl,
  SATELLITE_ATTRIBUTION,
  satelliteTileUrl,
} from '~/utils/map-tiles'

const US_CENTER: [number, number] = [39.8283, -98.5795]
const YARD_ZOOM = 18

const props = withDefaults(defineProps<{
  latitude: number | string | null
  longitude: number | string | null
  boundary: GeoJsonPolygon | null
  heading?: number
  addressLine1?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
}>(), {
  heading: 0,
  addressLine1: null,
  city: null,
  state: null,
  postalCode: null,
})

const emit = defineEmits<{
  'update:boundary': [GeoJsonPolygon]
  'update:heading': [value: number]
}>()

const mapEl = ref<HTMLElement | null>(null)
const ready = ref(false)
const drawing = ref(false)
const draftPoints = ref<Array<[number, number]>>([])
const errorMessage = ref('')
const basemap = ref<'satellite' | 'street'>('satellite')

type LeafletModule = typeof import('leaflet')
let L: LeafletModule | null = null
let map: import('leaflet').Map | null = null
let baseLayer: import('leaflet').TileLayer | null = null
let labelsLayer: import('leaflet').TileLayer | null = null
let fenceLayer: import('leaflet').Polygon | null = null
let pinMarker: import('leaflet').Marker | null = null
let draftLayer: import('leaflet').LayerGroup | null = null
let cancelled = false
let stopSizeWatch: (() => void) | null = null
let applyingHeading = false

/** Fraction of the viewport left as margin around the captured fence. */
const FRAME_INSET = 0.12

const hasFence = computed(() => Boolean(props.boundary?.coordinates?.[0]?.length))
const canFinishDraw = computed(() => draftPoints.value.length >= 3)
const sitePin = ref<{ latitude: number, longitude: number } | null>(parsePin(props.latitude, props.longitude))
let recenterTimer: ReturnType<typeof setTimeout> | undefined

function paintPin() {
  if (!map || !L) return
  pinMarker?.remove()
  pinMarker = null
  const pin = parsePin(props.latitude, props.longitude) ?? sitePin.value
  if (!pin) return
  pinMarker = L.marker([pin.latitude, pin.longitude], {
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
  if (drawing.value || !isPlausibleYardFence(props.boundary)) return
  const ring = props.boundary?.coordinates?.[0]
  if (!ring?.length) return
  try {
    fenceLayer = L.polygon(ring.map(([lng, lat]) => [lat, lng] as [number, number]), {
      color: '#F0A422',
      weight: 2,
      fillColor: '#F0A422',
      fillOpacity: 0.14,
      interactive: false,
    }).addTo(map)
  }
  catch {
    fenceLayer = null
  }
}

function paintDraft() {
  if (!map || !L) return
  draftLayer?.clearLayers()
  if (!drawing.value || !draftPoints.value.length) return
  const latlngs = draftPoints.value.map(([lat, lng]) => [lat, lng] as [number, number])
  L.polyline(latlngs, {
    color: '#F0A422',
    weight: 2,
    dashArray: '6 4',
    interactive: false,
  }).addTo(draftLayer!)
  for (const [lat, lng] of draftPoints.value) {
    L.circleMarker([lat, lng], {
      radius: 7,
      color: '#0C1E30',
      weight: 2,
      fillColor: '#F0A422',
      fillOpacity: 1,
      interactive: false,
    }).addTo(draftLayer!)
  }
}

function paintBaseLayer() {
  if (!map || !L) return
  baseLayer?.remove()
  labelsLayer?.remove()
  labelsLayer = null
  if (basemap.value === 'satellite') {
    baseLayer = L.tileLayer(satelliteTileUrl(), {
      maxZoom: 22,
      maxNativeZoom: 19,
      attribution: SATELLITE_ATTRIBUTION,
    })
    baseLayer.addTo(map)
    baseLayer.bringToBack()
    labelsLayer = L.tileLayer(LABELS_TILE_URL, {
      maxZoom: 22,
      attribution: LABELS_ATTRIBUTION,
      pane: 'overlayPane',
    })
    labelsLayer.addTo(map)
  }
  else {
    baseLayer = L.tileLayer(osmTileUrl(), {
      maxZoom: 22,
      attribution: OSM_ATTRIBUTION,
    })
    baseLayer.addTo(map)
    baseLayer.bringToBack()
  }
}

function mapIsLoaded(): boolean {
  return Boolean(map && (map as unknown as { _loaded?: boolean })._loaded)
}

function applyHeading(value: number) {
  if (!map || !mapIsLoaded()) return
  applyingHeading = true
  try {
    map.setBearing(normalizeHeading(value))
  }
  catch {
    // leaflet-rotate throws if a view has not been set yet.
  }
  applyingHeading = false
}

function onRotate() {
  if (!map || applyingHeading) return
  const next = normalizeHeading(map.getBearing())
  if (headingDelta(next, props.heading) < 0.4) return
  emit('update:heading', next)
}

function applySiteView(site: { latitude: number, longitude: number } | null = sitePin.value) {
  if (!map) return
  const pin = site ?? { latitude: US_CENTER[0], longitude: US_CENTER[1] }
  const zoom = site ? YARD_ZOOM : 4
  try {
    map.setView([pin.latitude, pin.longitude], zoom, { animate: false })
  }
  catch {
    return
  }
  const box = bboxFromPolygon(props.boundary)
  if (!box || !isPlausibleYardFence(props.boundary)) return
  try {
    map.fitBounds(
      [[box.south, box.west], [box.north, box.east]],
      { animate: false, padding: [40, 40], maxZoom: 19 },
    )
  }
  catch {
    // Keep the address view when Leaflet cannot fit a stored fence.
  }
}

async function geocodeAddress(): Promise<{ latitude: number, longitude: number } | null> {
  const pin = await geocodeStructured()
  if (pin) return pin
  const q = formatAddressSearchQuery({
    addressLine1: props.addressLine1,
    city: props.city,
    state: props.state,
    postalCode: props.postalCode,
  })
  if (q.length < 3) return null
  try {
    const result = await $fetch('/api/geocode/search', { query: { q, limit: 1 } })
    const hit = result.results?.[0]
    return hit ? parsePin(hit.latitude, hit.longitude) : null
  }
  catch {
    return null
  }
}

/**
 * Nominatim structured search — far more accurate for known street addresses
 * than Photon's free-text. Free, no API key.
 */
async function geocodeStructured(): Promise<{ latitude: number, longitude: number } | null> {
  const street = props.addressLine1?.trim()
  if (!street || street.length < 3) return null
  const params = new URLSearchParams({
    street,
    format: 'jsonv2',
    countrycodes: 'us',
    limit: '1',
    addressdetails: '0',
  })
  if (props.city?.trim()) params.set('city', props.city.trim())
  if (props.state?.trim()) params.set('state', props.state.trim())
  if (props.postalCode?.trim()) params.set('postalcode', props.postalCode.trim())
  try {
    const results = await $fetch<Array<{ lat: string, lon: string }>>(
      `https://nominatim.openstreetmap.org/search?${params.toString()}`,
      { headers: { 'Accept': 'application/json' }, timeout: 6000 },
    )
    const hit = results?.[0]
    if (!hit) return null
    return parsePin(hit.lat, hit.lon)
  }
  catch {
    return null
  }
}

async function resolveSite(): Promise<{ latitude: number, longitude: number } | null> {
  return parsePin(props.latitude, props.longitude) ?? await geocodeAddress()
}

/**
 * The fence is whatever sits inside the on-screen frame. With the map rotated
 * to the street this yields a quad that hugs the roadway, not a north-up box.
 */
function captureFence(): GeoJsonPolygon | null {
  if (!map || !L || !mapIsLoaded() || !ready.value) return null
  try {
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
    const vertices = corners.map(([x, y]) => {
      const latlng = map!.containerPointToLatLng(L!.point(x, y))
      return [latlng.lng, latlng.lat] as [number, number]
    })
    const polygon = polygonFromRing(vertices)
    if (!polygon) return null
    if (!isPlausibleYardFence(polygon)) {
      errorMessage.value = 'Zoom in until the gold frame hugs the usable yard, then set the fence.'
      return null
    }
    errorMessage.value = ''
    emit('update:boundary', polygon)
    return polygon
  }
  catch {
    errorMessage.value = 'Wait for the map to finish loading, then set the fence.'
    return null
  }
}

function onMapClick(event: import('leaflet').LeafletMouseEvent) {
  if (!drawing.value) return
  draftPoints.value = [...draftPoints.value, [event.latlng.lat, event.latlng.lng]]
}

function startDraw() {
  if (!map || !ready.value) return
  drawing.value = true
  draftPoints.value = []
  fenceLayer?.remove()
  fenceLayer = null
  map.on('click', onMapClick)
  paintDraft()
}

function cancelDraw() {
  if (!map) return
  drawing.value = false
  draftPoints.value = []
  map.off('click', onMapClick)
  draftLayer?.clearLayers()
  paintFence()
}

function undoVertex() {
  if (draftPoints.value.length < 1) return
  draftPoints.value = draftPoints.value.slice(0, -1)
}

function finishDraw() {
  const polygon = polygonFromRing(
    draftPoints.value.map(([lat, lng]) => [lng, lat]),
  )
  if (!polygon || !map) return
  if (!isPlausibleYardFence(polygon)) {
    errorMessage.value = 'That zone is too large or too small. Tap the corners of the usable yard.'
    return
  }
  errorMessage.value = ''
  emit('update:boundary', polygon)
  drawing.value = false
  draftPoints.value = []
  map.off('click', onMapClick)
  draftLayer?.clearLayers()
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
    const site = await resolveSite()
    if (cancelled || !mapEl.value) return
    sitePin.value = site
    L = await loadLeaflet()
    if (cancelled || !mapEl.value) return
    map = L.map(mapEl.value, {
      zoomControl: true,
      attributionControl: true,
      rotate: true,
      touchRotate: true,
      rotateControl: false,
      shiftKeyRotate: true,
    })
    applySiteView(site)
    paintBaseLayer()
    draftLayer = L.layerGroup().addTo(map)
    map.on('rotate', onRotate)
    paintFence()
    paintPin()
    map.invalidateSize()
    applySiteView(site)
    applyHeading(props.heading)
    ready.value = true
    errorMessage.value = ''
    stopSizeWatch = observeMapSize(mapEl.value, () => {
      if (cancelled || !map) return
      map.invalidateSize()
    })
  }
  catch (error) {
    if (!cancelled) {
      errorMessage.value = 'Map failed to load. Go back and open Draw yard again.'
      console.warn('[LocationMapEditor]', error)
    }
  }
}

async function recenterFromProps() {
  if (!ready.value || drawing.value) return
  const site = await resolveSite()
  if (cancelled) return
  sitePin.value = site
  paintPin()
  if (!hasFence.value) applySiteView(site)
}

watch(() => props.boundary, () => {
  if (!ready.value) return
  paintFence()
})
watch(draftPoints, () => {
  if (!ready.value) return
  paintDraft()
})
watch(() => [
  props.latitude,
  props.longitude,
  props.addressLine1,
  props.city,
  props.state,
  props.postalCode,
] as const, () => {
  clearTimeout(recenterTimer)
  recenterTimer = setTimeout(() => {
    void recenterFromProps()
  }, 350)
})
watch(() => props.heading, (value) => {
  if (!ready.value || !map) return
  if (headingDelta(map.getBearing(), value) < 0.4) return
  applyHeading(value)
})
watch(basemap, () => {
  if (!ready.value) return
  paintBaseLayer()
})

onMounted(() => {
  cancelled = false
  boot()
})
onBeforeUnmount(() => {
  cancelled = true
  clearTimeout(recenterTimer)
  stopSizeWatch?.()
  stopSizeWatch = null
  try {
    map?.off('click', onMapClick)
    map?.off()
    pinMarker?.remove()
    fenceLayer?.remove()
    draftLayer?.remove()
    labelsLayer?.remove()
    baseLayer?.remove()
    map?.remove()
  }
  catch {
    // Leaflet throws if the pane was already detached during a route change.
  }
  map = null
  fenceLayer = null
  pinMarker = null
  draftLayer = null
  labelsLayer = null
  baseLayer = null
  L = null
})

defineExpose({
  captureFence,
  recenter: () => applySiteView(sitePin.value),
})
</script>

<template>
  <div>
    <div
      class="map-frame-wrap"
      :class="{ 'is-drawing': drawing }"
    >
      <div
        ref="mapEl"
        class="location-map place"
        role="application"
        :aria-label="drawing
          ? 'Aerial map. Tap the corners of the usable yard, then finish the zone.'
          : 'Aerial map. Draw the yard zone by tapping corners, or pan until the yard fills the frame.'"
      />
      <div
        class="fence-frame"
        aria-hidden="true"
      />
    </div>
    <div
      class="map-basemap"
      role="group"
      aria-label="Map type"
    >
      <button
        type="button"
        class="fchip"
        :class="{ on: basemap === 'satellite' }"
        :aria-pressed="basemap === 'satellite'"
        @click="basemap = 'satellite'"
      >
        Satellite
      </button>
      <button
        type="button"
        class="fchip"
        :class="{ on: basemap === 'street' }"
        :aria-pressed="basemap === 'street'"
        @click="basemap = 'street'"
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
    <template v-if="drawing">
      <p class="field-hint mt-3">
        Tap each corner of the usable yard. You need at least three points.
      </p>
      <button
        type="button"
        class="btn-dark mt-3 w-full"
        :disabled="!canFinishDraw"
        @click="finishDraw"
      >
        Finish zone
      </button>
      <div class="mt-2 flex gap-2">
        <button
          type="button"
          class="btn-ghost flex-1"
          :disabled="draftPoints.length < 1"
          @click="undoVertex"
        >
          Undo point
        </button>
        <button
          type="button"
          class="btn-ghost flex-1"
          @click="cancelDraw"
        >
          Cancel
        </button>
      </div>
    </template>
    <template v-else>
      <button
        type="button"
        class="btn-dark mt-3 w-full"
        :disabled="!ready"
        @click="startDraw"
      >
        {{ hasFence ? 'Redraw zone' : 'Draw zone' }}
      </button>
      <button
        type="button"
        class="btn-ghost mt-2 w-full"
        :disabled="!ready"
        @click="captureFence"
      >
        {{ hasFence ? 'Update fence to this view' : 'Use this view as fence' }}
      </button>
      <p class="field-hint mt-2">
        Align to the road on the aerial photo, then pan and zoom until the yard fills the gold frame.
      </p>
    </template>
  </div>
</template>
