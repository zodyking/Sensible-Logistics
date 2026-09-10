<script setup lang="ts">
import { LOCATION_TYPE_LABELS, type LocationType } from '#shared/utils/domain'
import { loadLeaflet, observeMapSize, waitForMapSize } from '~/utils/leaflet-map'
import {
  LABELS_ATTRIBUTION,
  LABELS_TILE_URL,
  OSM_ATTRIBUTION,
  osmTileUrl,
  SATELLITE_ATTRIBUTION,
  satelliteTileUrl,
} from '~/utils/map-tiles'

type LeafletModule = typeof import('leaflet')
type Basemap = 'street' | 'satellite'

export interface DispatchMapSite {
  id: string
  name: string
  type: LocationType
  latitude: number | null
  longitude: number | null
  occupancy: number
}

const props = defineProps<{
  locations: DispatchMapSite[]
  selectedId: string | null
}>()

const emit = defineEmits<{
  select: [id: string]
}>()

const host = ref<HTMLElement | null>(null)
const basemap = ref<Basemap>('street')
const FALLBACK: [number, number] = [40.792, -74.042]

let map: import('leaflet').Map | null = null
let pinsLayer: import('leaflet').LayerGroup | null = null
let baseLayer: import('leaflet').TileLayer | null = null
let labelsLayer: import('leaflet').TileLayer | null = null
let Lref: LeafletModule | null = null
let stopSize: (() => void) | null = null
let cancelled = false
let sizeRetries: number[] = []

function sitesWithPins(list: DispatchMapSite[]) {
  return list.filter(site => site.latitude != null && site.longitude != null) as Array<DispatchMapSite & { latitude: number, longitude: number }>
}

function pinHtml(site: DispatchMapSite, selected: boolean) {
  const count = site.occupancy
  const on = selected ? ' on' : ''
  return `<button type="button" class="dmap-pin${on}" aria-label="${site.name}, ${count} containers">
    <b>${count}</b>
    <span>${site.name}</span>
  </button>`
}

function drawPins() {
  if (!map || !pinsLayer || !Lref) return
  pinsLayer.clearLayers()
  const L = Lref
  for (const site of sitesWithPins(props.locations)) {
    const icon = L.divIcon({
      className: 'dmap-pin-wrap',
      html: pinHtml(site, site.id === props.selectedId),
      iconSize: [120, 44],
      iconAnchor: [24, 22],
    })
    const marker = L.marker([site.latitude, site.longitude], { icon, keyboard: true })
    marker.on('click', () => emit('select', site.id))
    marker.bindTooltip(LOCATION_TYPE_LABELS[site.type], { direction: 'top', offset: [0, -12] })
    pinsLayer.addLayer(marker)
  }
}

function fitSites() {
  if (!map || !Lref) return
  const pins = sitesWithPins(props.locations)
  if (!pins.length) {
    map.setView(FALLBACK, 10)
    return
  }
  if (pins.length === 1) {
    map.setView([pins[0]!.latitude, pins[0]!.longitude], 13)
    return
  }
  const bounds = Lref.latLngBounds(pins.map(site => [site.latitude, site.longitude] as [number, number]))
  map.fitBounds(bounds, { padding: [48, 48], maxZoom: 13 })
}

function paintBaseLayer() {
  if (!map || !Lref) return
  baseLayer?.remove()
  labelsLayer?.remove()
  labelsLayer = null
  if (basemap.value === 'satellite') {
    baseLayer = Lref.tileLayer(satelliteTileUrl(), {
      maxZoom: 19,
      maxNativeZoom: 19,
      attribution: SATELLITE_ATTRIBUTION,
    })
    labelsLayer = Lref.tileLayer(LABELS_TILE_URL, {
      maxZoom: 19,
      attribution: LABELS_ATTRIBUTION,
      pane: 'overlayPane',
    })
  }
  else {
    baseLayer = Lref.tileLayer(osmTileUrl(), {
      maxZoom: 19,
      attribution: OSM_ATTRIBUTION,
    })
  }
  baseLayer.addTo(map)
  baseLayer.bringToBack()
  labelsLayer?.addTo(map)
}

function syncMapSize() {
  if (!map) return
  map.invalidateSize({ animate: false })
}

function scheduleSizeSync() {
  for (const id of sizeRetries) window.clearTimeout(id)
  sizeRetries = [0, 50, 200, 600].map(ms => window.setTimeout(() => {
    syncMapSize()
    if (ms === 0) fitSites()
  }, ms))
}

function createMap(L: LeafletModule, el: HTMLElement) {
  if (map || cancelled) return
  Lref = L
  map = L.map(el, {
    zoomControl: true,
    attributionControl: true,
  })
  paintBaseLayer()
  pinsLayer = L.layerGroup().addTo(map)
  drawPins()
  fitSites()
  map.whenReady(() => {
    syncMapSize()
    fitSites()
  })
  scheduleSizeSync()
  stopSize?.()
  stopSize = observeMapSize(el, () => syncMapSize())
}

async function boot() {
  const el = host.value
  if (!el || cancelled) return
  const L = await loadLeaflet()
  if (cancelled || !host.value) return
  const sized = await waitForMapSize(el, () => cancelled, 4000)
  if (cancelled || !host.value) return
  if (sized) {
    createMap(L, host.value)
    return
  }
  stopSize = observeMapSize(el, () => {
    if (map) {
      syncMapSize()
      return
    }
    if (el.clientWidth > 8 && el.clientHeight > 8) createMap(L, el)
  })
}

watch(() => props.locations, () => {
  drawPins()
  if (!props.selectedId) fitSites()
}, { deep: true })

watch(() => props.selectedId, (id) => {
  drawPins()
  if (!map || !id) return
  const site = sitesWithPins(props.locations).find(item => item.id === id)
  if (site) map.panTo([site.latitude, site.longitude], { animate: true })
})

watch(basemap, () => {
  paintBaseLayer()
})

onMounted(() => {
  cancelled = false
  void nextTick(() => {
    void boot()
  })
})

onBeforeUnmount(() => {
  cancelled = true
  for (const id of sizeRetries) window.clearTimeout(id)
  sizeRetries = []
  stopSize?.()
  stopSize = null
  try {
    labelsLayer?.remove()
    baseLayer?.remove()
    pinsLayer?.remove()
    map?.remove()
  }
  catch {
    // Leaflet throws if the pane was already detached during a route change.
  }
  map = null
  pinsLayer = null
  labelsLayer = null
  baseLayer = null
  Lref = null
})
</script>

<template>
  <div class="dmap-wrap">
    <div
      ref="host"
      class="dmap"
      role="application"
      aria-label="Location map"
    />
    <div
      class="dmap-basemap"
      role="group"
      aria-label="Map type"
    >
      <button
        type="button"
        :class="{ on: basemap === 'street' }"
        :aria-pressed="basemap === 'street'"
        @click="basemap = 'street'"
      >
        Map
      </button>
      <button
        type="button"
        :class="{ on: basemap === 'satellite' }"
        :aria-pressed="basemap === 'satellite'"
        @click="basemap = 'satellite'"
      >
        Satellite
      </button>
    </div>
  </div>
</template>
