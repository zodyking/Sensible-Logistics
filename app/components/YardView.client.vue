<script setup lang="ts">
import Konva from 'konva'
import { CONTAINER_TYPE_PAINT, EQUIPMENT_TYPE_SHORT, equipmentFootprintMeters } from '#shared/utils/domain'
import type { ContainerType, EquipmentType } from '#shared/utils/domain'
import { formatChassisNumber, formatContainerNumber } from '#shared/utils/iso6346'
import { lngLatToLocal, localToLngLat, nearestSlot, type GeoJsonGeometry, type YardLayoutOrigin } from '#shared/utils/yard-plan'
import { YARD_STYLE } from '#shared/utils/yard-style'

type Feature = {
  id: string
  type: 'PAVEMENT' | 'BUILDING' | 'ROAD' | 'DRIVEWAY' | 'RAIL' | 'FENCE' | 'GATE' | 'VEGETATION'
  localGeometry: GeoJsonGeometry
  source: string
  confidence: number
  manuallyModified: boolean
}

type Slot = {
  id: string
  code: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

type Box = {
  id: string
  number: string
  containerType: ContainerType
  equipmentType: EquipmentType
  isLoaded: boolean
  latitude: number | null
  longitude: number | null
  rotation: number
}

type BareChassis = {
  id: string
  number: string
  x: number | null
  y: number | null
  rotation: number
}

const props = defineProps<{
  locationId: string
  origin: YardLayoutOrigin
  features: Feature[]
  slots: Slot[]
  containers: Box[]
  chassis: BareChassis[]
  canEdit: boolean
}>()

const emit = defineEmits<{
  moved: []
}>()

const host = ref<HTMLDivElement | null>(null)
const snap = ref(false)
const editMode = ref(false)
const showSlots = ref(true)
const errorMessage = ref('')
const scaleBarPx = ref(80)

let stage: Konva.Stage | null = null
let world: Konva.Group | null = null
let lastPinch = 0

const FEATURE_PAINT: Record<Feature['type'], { fill: string, stroke: string, width: number, dash?: number[] }> = {
  PAVEMENT: { fill: YARD_STYLE.pavement, stroke: YARD_STYLE.pavementStroke, width: 1 },
  ROAD: { fill: YARD_STYLE.road, stroke: YARD_STYLE.roadStroke, width: 1 },
  DRIVEWAY: { fill: YARD_STYLE.driveway, stroke: YARD_STYLE.roadStroke, width: 1 },
  BUILDING: { fill: YARD_STYLE.buildingFill, stroke: YARD_STYLE.buildingStroke, width: 1.6 },
  RAIL: { fill: YARD_STYLE.rail, stroke: YARD_STYLE.rail, width: 1 },
  FENCE: { fill: 'transparent', stroke: YARD_STYLE.fence, width: 1.4, dash: [6, 4] },
  GATE: { fill: 'rgba(240,164,34,0.25)', stroke: YARD_STYLE.gate, width: 2 },
  VEGETATION: { fill: YARD_STYLE.vegetation, stroke: '#5E6A4E', width: 0.6 },
}

const FEATURE_ORDER: Feature['type'][] = [
  'PAVEMENT', 'ROAD', 'DRIVEWAY', 'RAIL', 'VEGETATION', 'BUILDING', 'FENCE', 'GATE',
]

function toStage(x: number, y: number) {
  return { x, y: props.origin.planeHeight - y }
}

function fromStage(x: number, y: number) {
  return { x, y: props.origin.planeHeight - y }
}

function geometryPoints(geometry: GeoJsonGeometry): number[][] {
  const rings: [number, number][][] = []
  if (geometry.type === 'Polygon') rings.push(geometry.coordinates[0] ?? [])
  else if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates) rings.push(poly[0] ?? [])
  }
  else if (geometry.type === 'LineString') rings.push(geometry.coordinates)
  else rings.push(...geometry.coordinates)
  return rings.map(ring => ring.flatMap((pt) => {
    const mapped = toStage(pt[0], pt[1])
    return [mapped.x, mapped.y]
  }))
}

function translateGeometry(geometry: GeoJsonGeometry, dx: number, dy: number): GeoJsonGeometry {
  const shift = (pt: [number, number]): [number, number] => [pt[0] + dx, pt[1] + dy]
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geometry.coordinates.map(ring => ring.map(shift)) }
  }
  if (geometry.type === 'MultiPolygon') {
    return { type: 'MultiPolygon', coordinates: geometry.coordinates.map(poly => poly.map(ring => ring.map(shift))) }
  }
  if (geometry.type === 'LineString') {
    return { type: 'LineString', coordinates: geometry.coordinates.map(shift) }
  }
  return { type: 'MultiLineString', coordinates: geometry.coordinates.map(line => line.map(shift)) }
}

function fit(stageNode: Konva.Stage, group: Konva.Group) {
  const pad = 24
  const sx = (stageNode.width() - pad * 2) / Math.max(props.origin.planeWidth, 1)
  const sy = (stageNode.height() - pad * 2) / Math.max(props.origin.planeHeight, 1)
  const scale = Math.min(sx, sy)
  group.scale({ x: scale, y: scale })
  group.position({
    x: (stageNode.width() - props.origin.planeWidth * scale) / 2,
    y: (stageNode.height() - props.origin.planeHeight * scale) / 2,
  })
}

function bindAssetDrag(group: Konva.Group, asset: { kind: 'container' | 'chassis', id: string, rotation: number }) {
  group.on('dragstart', () => {
    stage!.draggable(false)
  })
  group.on('dblclick dbltap', () => {
    group.rotation(group.rotation() + 15)
  })
  group.on('dragend', async () => {
    stage!.draggable(true)
    let local = fromStage(group.x(), group.y())
    let rotation = -group.rotation()
    if (snap.value) {
      const hit = nearestSlot(local.x, local.y, props.slots)
      if (hit) {
        local = { x: hit.x, y: hit.y }
        rotation = hit.rotation
        const pos = toStage(local.x, local.y)
        group.position(pos)
        group.rotation(-rotation)
      }
    }
    try {
      if (asset.kind === 'container') {
        const geo = localToLngLat(props.origin, local.x, local.y)
        await $fetch(`/api/locations/${props.locationId}/placements`, {
          method: 'POST',
          body: {
            eventId: crypto.randomUUID(),
            containerId: asset.id,
            placement: { latitude: geo.latitude, longitude: geo.longitude, rotation },
          },
        })
      }
      else {
        await $fetch(`/api/locations/${props.locationId}/yard/chassis/${asset.id}`, {
          method: 'PUT',
          body: { x: local.x, y: local.y, rotation },
        })
      }
      emit('moved')
    }
    catch (error) {
      errorMessage.value = apiErrorMessage(error, 'Could not save that placement.')
    }
  })
}

function paint(stageNode: Konva.Stage) {
  stageNode.destroyChildren()
  const layer = new Konva.Layer()
  stageNode.add(layer)
  world = new Konva.Group({ name: 'world' })
  layer.add(world)
  world.add(new Konva.Rect({
    x: 0,
    y: 0,
    width: props.origin.planeWidth,
    height: props.origin.planeHeight,
    fill: YARD_STYLE.ground,
    listening: false,
  }))

  for (const type of FEATURE_ORDER) {
    const style = FEATURE_PAINT[type]
    for (const feature of props.features.filter(item => item.type === type)) {
      for (const points of geometryPoints(feature.localGeometry)) {
        if (points.length < 4) continue
        if (type === 'RAIL') {
          world.add(new Konva.Line({
            points,
            closed: true,
            stroke: YARD_STYLE.rail,
            strokeWidth: 1.8,
            lineJoin: 'round',
            listening: false,
          }))
          world.add(new Konva.Line({
            points,
            closed: true,
            stroke: YARD_STYLE.ground,
            strokeWidth: 0.55,
            lineJoin: 'round',
            listening: false,
          }))
          continue
        }
        const shape = new Konva.Line({
          points,
          closed: feature.localGeometry.type !== 'LineString' && feature.localGeometry.type !== 'MultiLineString',
          fill: style.fill === 'transparent' ? undefined : style.fill,
          stroke: style.stroke,
          strokeWidth: style.width,
          dash: style.dash,
          lineJoin: 'round',
          lineCap: 'round',
          shadowColor: type === 'BUILDING' ? 'rgba(20,20,18,0.28)' : undefined,
          shadowBlur: type === 'BUILDING' ? 8 : 0,
          shadowOffset: type === 'BUILDING' ? { x: 1.2, y: 2.2 } : undefined,
          draggable: editMode.value && props.canEdit,
          name: `feature:${feature.id}`,
        })
        if (editMode.value && props.canEdit) {
          shape.on('dragend', async () => {
            const dx = shape.x()
            const dy = -shape.y()
            const next = translateGeometry(feature.localGeometry, dx, dy)
            try {
              await $fetch(`/api/yard/features/${feature.id}`, {
                method: 'PATCH',
                body: { localGeometry: next },
              })
              feature.localGeometry = next
              feature.manuallyModified = true
              shape.position({ x: 0, y: 0 })
              emit('moved')
            }
            catch (error) {
              errorMessage.value = apiErrorMessage(error, 'Could not save that correction.')
              shape.position({ x: 0, y: 0 })
            }
          })
        }
        world.add(shape)
      }
    }
  }

  if (showSlots.value) {
    for (const slot of props.slots) {
      const pos = toStage(slot.x, slot.y)
      world.add(new Konva.Rect({
        x: pos.x,
        y: pos.y,
        width: slot.width,
        height: slot.height,
        offsetX: slot.width / 2,
        offsetY: slot.height / 2,
        rotation: -slot.rotation,
        fill: YARD_STYLE.slot,
        stroke: YARD_STYLE.slotStroke,
        strokeWidth: 0.4,
        listening: false,
      }))
    }
  }

  for (const item of props.chassis) {
    if (item.x == null || item.y == null) continue
    world.add(makeChassis(item))
  }
  for (const box of props.containers) {
    world.add(makeContainer(box))
  }

  fit(stageNode, world)
  scaleBarPx.value = Math.max(36, 20 * world.scaleX())
  layer.draw()
}

function makeContainer(box: Box) {
  const size = equipmentFootprintMeters(box.equipmentType)
  const paint = CONTAINER_TYPE_PAINT[box.containerType]
  let x = props.origin.planeWidth / 2
  let y = props.origin.planeHeight / 2
  if (box.latitude != null && box.longitude != null) {
    const local = lngLatToLocal(props.origin, box.latitude, box.longitude)
    x = local.x
    y = local.y
  }
  const pos = toStage(x, y)
  const group = new Konva.Group({
    x: pos.x,
    y: pos.y,
    rotation: -box.rotation,
    draggable: true,
    name: `container:${box.id}`,
  })
  group.add(new Konva.Rect({
    width: size.width,
    height: size.length,
    offsetX: size.width / 2,
    offsetY: size.length / 2,
    fill: box.isLoaded ? paint.fill : paint.emptyFill,
    stroke: paint.stroke,
    strokeWidth: 0.18,
    cornerRadius: 0.12,
    shadowColor: 'rgba(20,31,41,0.35)',
    shadowBlur: 6,
    shadowOffset: { x: 0.4, y: 0.8 },
  }))
  const rib = size.width / 6
  for (let i = -2; i <= 2; i++) {
    group.add(new Konva.Line({
      points: [i * rib, -size.length / 2 + 0.3, i * rib, size.length / 2 - 0.3],
      stroke: 'rgba(20,20,18,0.18)',
      strokeWidth: 0.06,
      listening: false,
    }))
  }
  group.add(new Konva.Text({
    text: formatContainerNumber(box.number) || box.number,
    fontSize: 0.85,
    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
    fill: box.isLoaded ? '#F7F4EE' : '#141F29',
    width: size.length,
    offsetX: size.length / 2,
    offsetY: 0.4,
    rotation: 90,
    align: 'center',
    listening: false,
  }))
  group.add(new Konva.Text({
    text: `${EQUIPMENT_TYPE_SHORT[box.equipmentType] || ''} · ${box.isLoaded ? 'L' : 'E'}`,
    fontSize: 0.55,
    fontFamily: 'Inter, sans-serif',
    fill: box.isLoaded ? '#F7F4EE' : '#39464F',
    width: size.length,
    offsetX: size.length / 2,
    offsetY: -0.7,
    rotation: 90,
    align: 'center',
    listening: false,
  }))
  bindAssetDrag(group, { kind: 'container', id: box.id, rotation: box.rotation })
  return group
}

function makeChassis(item: BareChassis) {
  const length = 12.2
  const width = 2.5
  const pos = toStage(item.x!, item.y!)
  const group = new Konva.Group({
    x: pos.x,
    y: pos.y,
    rotation: -item.rotation,
    draggable: true,
    name: `chassis:${item.id}`,
  })
  group.add(new Konva.Rect({
    width: 0.55,
    height: length - 0.8,
    offsetX: 0.275,
    offsetY: (length - 0.8) / 2,
    fill: YARD_STYLE.chassisFill,
    cornerRadius: 0.08,
  }))
  for (const side of [-1, 1]) {
    for (const along of [-length / 2 + 0.7, length / 2 - 0.7]) {
      group.add(new Konva.Rect({
        x: side * (width / 2 - 0.25),
        y: along,
        width: 0.7,
        height: 1.05,
        offsetX: 0.35,
        offsetY: 0.52,
        fill: YARD_STYLE.chassisWheel,
        cornerRadius: 0.12,
      }))
    }
  }
  group.add(new Konva.Text({
    text: formatChassisNumber(item.number) || item.number,
    fontSize: 0.7,
    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
    fill: '#F4F1EA',
    width: length,
    offsetX: length / 2,
    offsetY: 0.3,
    rotation: 90,
    align: 'center',
    listening: false,
  }))
  bindAssetDrag(group, { kind: 'chassis', id: item.id, rotation: item.rotation })
  return group
}

function boot() {
  if (!host.value) return
  stage?.destroy()
  const rect = host.value.getBoundingClientRect()
  stage = new Konva.Stage({
    container: host.value,
    width: Math.max(320, rect.width),
    height: Math.max(320, rect.height),
    draggable: true,
  })
  stage.on('wheel', (event) => {
    event.evt.preventDefault()
    if (!stage) return
    const old = stage.scaleX()
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    const scale = event.evt.deltaY > 0 ? old * 0.92 : old * 1.08
    const next = Math.min(4, Math.max(0.35, scale))
    const mouse = {
      x: (pointer.x - stage.x()) / old,
      y: (pointer.y - stage.y()) / old,
    }
    stage.scale({ x: next, y: next })
    stage.position({
      x: pointer.x - mouse.x * next,
      y: pointer.y - mouse.y * next,
    })
  })
  stage.on('touchmove', (event) => {
    const touches = event.evt.touches
    if (touches.length !== 2 || !stage) return
    event.evt.preventDefault()
    const a = touches[0]!
    const b = touches[1]!
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    if (lastPinch) {
      const old = stage.scaleX()
      const next = Math.min(4, Math.max(0.35, old * (dist / lastPinch)))
      stage.scale({ x: next, y: next })
    }
    lastPinch = dist
  })
  stage.on('touchend', () => {
    lastPinch = 0
  })
  paint(stage)
}

onMounted(() => {
  boot()
  window.addEventListener('resize', boot)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', boot)
  stage?.destroy()
  stage = null
})

watch(() => [props.features, props.containers, props.chassis, props.slots, editMode.value, showSlots.value], () => {
  if (stage) paint(stage)
}, { deep: true })
</script>

<template>
  <div>
    <div class="yard-toolbar">
      <label class="yard-toggle">
        <input
          v-model="snap"
          type="checkbox"
        >
        Snap to stalls
      </label>
      <label class="yard-toggle">
        <input
          v-model="showSlots"
          type="checkbox"
        >
        Suggested stalls
      </label>
      <label
        v-if="canEdit"
        class="yard-toggle"
      >
        <input
          v-model="editMode"
          type="checkbox"
        >
        Edit site plan
      </label>
      <span class="yard-hint">Drag to move. Double-tap to rotate. Pinch or scroll to zoom.</span>
    </div>

    <p
      v-if="errorMessage"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ errorMessage }}</span>
    </p>

    <div class="yard-stage">
      <div
        ref="host"
        class="yard-view"
        role="application"
        aria-label="Top-down yard plan. Drag containers and chassis to place them."
      />
      <div
        class="yard-scale"
        aria-hidden="true"
      >
        <i :style="{ width: `${scaleBarPx}px` }" />
        <small>20 m</small>
      </div>
    </div>
  </div>
</template>
