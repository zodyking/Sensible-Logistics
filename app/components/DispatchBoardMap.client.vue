<script setup lang="ts">
import { LOCATION_TYPE_LABELS, type LocationType } from '#shared/utils/domain'
import { loadLeaflet, observeMapSize, waitForMapSize } from '~/utils/leaflet-map'
import { OSM_ATTRIBUTION, osmTileUrl } from '~/utils/map-tiles'

type LeafletModule = typeof import('leaflet')

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
const FALLBACK: [number, number] = [40.792, -74.042]

let map: import('leaflet').Map | null = null
let layer: import('leaflet').LayerGroup | null = null
let Lref: LeafletModule | null = null
let stopSize: (() => void) | null = null

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
  if (!map || !layer || !Lref) return
  layer.clearLayers()
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
    layer.addLayer(marker)
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

async function boot() {
  const el = host.value
  if (!el) return
  const L = await loadLeaflet()
  Lref = L
  await waitForMapSize(el, () => false)
  map = L.map(el, {
    zoomControl: true,
    attributionControl: true,
  })
  L.tileLayer(osmTileUrl(), { attribution: OSM_ATTRIBUTION, maxZoom: 19 }).addTo(map)
  layer = L.layerGroup().addTo(map)
  drawPins()
  fitSites()
  map.invalidateSize()
  stopSize = observeMapSize(el, () => map?.invalidateSize())
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

onMounted(() => {
  void boot()
})

onBeforeUnmount(() => {
  stopSize?.()
  map?.remove()
  map = null
  layer = null
})
</script>

<template>
  <div
    ref="host"
    class="dmap"
    role="application"
    aria-label="Location map"
  />
</template>
