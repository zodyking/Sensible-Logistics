<script setup lang="ts">
import type { GeoJsonPolygon } from '#shared/utils/geo'
import { bboxFromPolygon, headingDelta, normalizeHeading, polygonFromRing } from '#shared/utils/geo'
import { isPlacedPin } from '#shared/utils/yard-slots'
import { loadLeaflet, observeMapSize, waitForMapSize } from '~/utils/leaflet-map'
import { OSM_ATTRIBUTION, osmTileUrl } from '~/utils/map-tiles'

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
const drawing = ref(false)
const draftPoints = ref<Array<[number, number]>>([])
const errorMessage = ref('')

type LeafletModule = typeof import('leaflet')
let L: LeafletModule | null = null
let map: import('leaflet').Map | null = null
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
  if (drawing.value) return
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
  const vertices = corners.map(([x, y]) => {
    const latlng = map!.containerPointToLatLng(L!.point(x, y))
    return [latlng.lng, latlng.lat] as [number, number]
  })
  const polygon = polygonFromRing(vertices)
  if (!polygon) return null
  emit('update:boundary', polygon)
  return polygon
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
    draftLayer = L.layerGroup().addTo(map)
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
watch(draftPoints, () => {
  if (!ready.value) return
  paintDraft()
})
watch(() => [props.latitude, props.longitude] as const, () => {
  if (!ready.value) return
  paintPin()
  if (!drawing.value && !hasFence.value) setInitialView()
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
    map?.off('click', onMapClick)
    map?.off()
    pinMarker?.remove()
    fenceLayer?.remove()
    draftLayer?.remove()
    map?.remove()
  }
  catch {
    // Leaflet throws if the pane was already detached during a route change.
  }
  map = null
  fenceLayer = null
  pinMarker = null
  draftLayer = null
  L = null
})

defineExpose({
  captureFence,
  recenter: setInitialView,
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
          ? 'OpenStreetMap. Tap the corners of the usable yard, then finish the zone.'
          : 'OpenStreetMap. Draw the yard zone by tapping corners, or pan until the yard fills the frame.'"
      />
      <div
        class="fence-frame"
        aria-hidden="true"
      />
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
        Draw by tapping corners, or align to the road and fill the gold frame.
        The fence follows the rotated view, so a framed zone stays square to the street.
      </p>
    </template>
  </div>
</template>
