<script setup lang="ts">
import type { ContainerType, EquipmentType } from '#shared/utils/domain'
import { CONTAINER_TYPE_PAINT, equipmentFootprintMeters } from '#shared/utils/domain'
import type { GeoJsonPolygon } from '#shared/utils/geo'
import {
  bboxFromPolygon,
  containerCorners,
  containerDoorEdge,
  pointInPolygon,
} from '#shared/utils/geo'
import { OSM_ATTRIBUTION, osmTileUrl } from '~/utils/map-tiles'

type LeafletModule = typeof import('leaflet')

export interface YardMapBox {
  id: string
  number: string
  containerType: ContainerType
  equipmentType: EquipmentType
  isLoaded: boolean
  latitude: number | null
  longitude: number | null
  rotation: number
}

const props = withDefaults(defineProps<{
  mode?: 'preview' | 'view' | 'place'
  boundary: GeoJsonPolygon | null
  latitude?: number | null
  longitude?: number | null
  containers: YardMapBox[]
  pending?: YardMapBox | null
  selectedId?: string | null
}>(), {
  mode: 'view',
  latitude: null,
  longitude: null,
  pending: null,
  selectedId: null,
})

const emit = defineEmits<{
  'select': [id: string]
  'update:pending': [value: { latitude: number, longitude: number, rotation: number }]
}>()

const mapEl = ref<HTMLElement | null>(null)
const ready = ref(false)
const errorMessage = ref('')

let L: LeafletModule | null = null
let map: import('leaflet').Map | null = null
let boundaryLayer: import('leaflet').Polygon | null = null
let boxesLayer: import('leaflet').LayerGroup | null = null
let pendingLayer: import('leaflet').LayerGroup | null = null
let dragHandle: import('leaflet').Marker | null = null
let fitted = false
let cancelled = false

function leaflet(): LeafletModule {
  if (!L) throw new Error('Map is not ready.')
  return L
}

function paintBox(box: YardMapBox, interactive: boolean) {
  if (!L) return null
  if (box.latitude == null || box.longitude == null) return null
  const size = equipmentFootprintMeters(box.equipmentType)
  const paint = CONTAINER_TYPE_PAINT[box.containerType]
  const corners = containerCorners(box.latitude, box.longitude, size.length, size.width, box.rotation)
  const polygon = L.polygon(corners, {
    color: props.selectedId === box.id ? '#F0A422' : paint.stroke,
    weight: props.selectedId === box.id ? 3 : 1.5,
    fillColor: box.isLoaded ? paint.fill : paint.emptyFill,
    fillOpacity: box.isLoaded ? 0.92 : 0.7,
    interactive,
  })
  const door = containerDoorEdge(box.latitude, box.longitude, size.length, size.width, box.rotation)
  const doorLine = L.polyline(door, {
    color: '#F0A422',
    weight: 3,
    interactive: false,
  })
  if (props.mode !== 'preview') {
    polygon.bindTooltip(box.number, { direction: 'top', opacity: 0.95 })
  }
  if (interactive) {
    polygon.on('click', (event: import('leaflet').LeafletMouseEvent) => {
      L!.DomEvent.stopPropagation(event)
      emit('select', box.id)
    })
  }
  return { polygon, doorLine }
}

function redrawBoxes() {
  if (!L || !boxesLayer) return
  boxesLayer.clearLayers()
  const interactive = props.mode === 'view'
  for (const box of props.containers) {
    if (props.pending && box.id === props.pending.id) continue
    const drawn = paintBox(box, interactive)
    if (!drawn) continue
    drawn.polygon.addTo(boxesLayer)
    drawn.doorLine.addTo(boxesLayer)
  }
}

function redrawPending() {
  if (!L || !pendingLayer || !map) return
  pendingLayer.clearLayers()
  dragHandle?.remove()
  dragHandle = null
  const pending = props.pending
  if (props.mode !== 'place' || !pending || pending.latitude == null || pending.longitude == null) return

  const drawn = paintBox(pending, false)
  if (drawn) {
    drawn.polygon.addTo(pendingLayer)
    drawn.doorLine.addTo(pendingLayer)
  }

  const icon = L.divIcon({
    className: 'box-handle',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
  dragHandle = L.marker([pending.latitude, pending.longitude], {
    draggable: true,
    icon,
    zIndexOffset: 800,
  })
  dragHandle.on('drag', () => {
    if (!dragHandle || !L || !pendingLayer) return
    const next = dragHandle.getLatLng()
    pendingLayer.clearLayers()
    const ghost: YardMapBox = { ...pending, latitude: next.lat, longitude: next.lng }
    const drawn = paintBox(ghost, false)
    if (drawn) {
      drawn.polygon.addTo(pendingLayer)
      drawn.doorLine.addTo(pendingLayer)
    }
  })
  dragHandle.on('dragend', () => {
    if (!dragHandle) return
    const next = dragHandle.getLatLng()
    if (props.boundary && !pointInPolygon(next.lat, next.lng, props.boundary)) {
      dragHandle.setLatLng([pending.latitude!, pending.longitude!])
      const drawn = paintBox(pending, false)
      pendingLayer?.clearLayers()
      if (drawn && pendingLayer) {
        drawn.polygon.addTo(pendingLayer)
        drawn.doorLine.addTo(pendingLayer)
      }
      return
    }
    emit('update:pending', {
      latitude: next.lat,
      longitude: next.lng,
      rotation: pending.rotation,
    })
  })
  dragHandle.addTo(map)
}

function paintBoundary() {
  if (!L || !map) return
  boundaryLayer?.remove()
  boundaryLayer = null
  const ring = props.boundary?.coordinates?.[0]
  if (!ring?.length) return
  const latlngs = ring.map(([lng, lat]) => [lat, lng] as [number, number])
  boundaryLayer = L.polygon(latlngs, {
    color: '#F0A422',
    weight: 2,
    fillColor: '#F0A422',
    fillOpacity: 0.12,
    interactive: false,
  }).addTo(map)
}

function fit() {
  if (!map || !L) return
  const size = map.getSize()
  if (!size.x || !size.y) {
    map.invalidateSize()
  }
  const box = bboxFromPolygon(props.boundary)
  try {
    if (box) {
      map.fitBounds(
        [[box.south, box.west], [box.north, box.east]],
        { animate: false, padding: [12, 12], maxZoom: 19 },
      )
      fitted = true
      return
    }
  }
  catch {
    // Fall through to a centre pin when Leaflet cannot fit a tiny container.
  }
  if (props.latitude != null && props.longitude != null) {
    map.setView([props.latitude, props.longitude], 18, { animate: false })
    fitted = true
  }
}

function onMapClick(event: import('leaflet').LeafletMouseEvent) {
  if (props.mode !== 'place' || !props.pending) return
  if (props.boundary && !pointInPolygon(event.latlng.lat, event.latlng.lng, props.boundary)) return
  emit('update:pending', {
    latitude: event.latlng.lat,
    longitude: event.latlng.lng,
    rotation: props.pending.rotation,
  })
}

async function boot() {
  if (!import.meta.client || !mapEl.value) return
  try {
    const mod = await import('leaflet')
    if (cancelled || !mapEl.value) return
    L = (mod.default ?? mod) as LeafletModule
    const preview = props.mode === 'preview'
    map = leaflet().map(mapEl.value, {
      zoomControl: !preview,
      attributionControl: !preview,
      dragging: !preview,
      scrollWheelZoom: !preview,
      doubleClickZoom: !preview,
      boxZoom: !preview,
      keyboard: !preview,
    })
    leaflet().tileLayer(osmTileUrl(), {
      maxZoom: 22,
      attribution: OSM_ATTRIBUTION,
    }).addTo(map)
    boxesLayer = leaflet().layerGroup().addTo(map)
    pendingLayer = leaflet().layerGroup().addTo(map)
    paintBoundary()
    redrawBoxes()
    redrawPending()
    map.on('click', onMapClick)
    ready.value = true
    requestAnimationFrame(() => {
      if (cancelled || !map) return
      map.invalidateSize()
      fit()
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
  paintBoundary()
  if (!fitted) fit()
})
watch(() => props.containers, () => {
  if (!ready.value) return
  redrawBoxes()
}, { deep: true })
watch(() => [props.pending, props.selectedId] as const, () => {
  if (!ready.value) return
  redrawBoxes()
  redrawPending()
}, { deep: true })

onMounted(() => {
  cancelled = false
  boot()
})
onBeforeUnmount(() => {
  cancelled = true
  try {
    map?.off()
    map?.remove()
  }
  catch {
    // Leaflet throws if the pane was already detached during a route change.
  }
  map = null
  boundaryLayer = null
  boxesLayer = null
  pendingLayer = null
  dragHandle = null
  L = null
})

defineExpose({
  recenter() {
    fitted = false
    fit()
  },
})
</script>

<template>
  <div>
    <div
      ref="mapEl"
      class="location-map"
      :class="mode"
      role="application"
      :aria-label="mode === 'place' ? 'Tap inside the fence to place the container. Drag the gold handle to nudge it.' : 'OpenStreetMap of this location with containers on the yard.'"
    />
    <p
      v-if="errorMessage"
      class="banner err mt-2 mb-0"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ errorMessage }}</span>
    </p>
    <p
      v-else-if="mode === 'place' && ready && !boundary"
      class="field-hint mt-2"
    >
      This location has no fence yet. Drop the pin near the address.
    </p>
    <p
      v-else-if="mode === 'place' && ready"
      class="field-hint mt-2"
    >
      Tap inside the gold fence to drop the box. Drag the handle, then rotate or align to the street.
    </p>
    <span
      v-if="mode === 'preview' && latitude != null"
      class="sr-only"
    >
      Map centered at {{ latitude.toFixed(5) }}, {{ longitude?.toFixed(5) }}
    </span>
  </div>
</template>
