<script setup lang="ts">
import {
  CONTAINER_STATUS_CHIP,
  CONTAINER_STATUS_LABELS,
  CONTAINER_TYPE_LABELS,
  DISPATCH_TASK_KIND_LABELS,
  DISPATCH_TASK_KINDS,
  DISPATCH_TASK_STATUS_CHIP,
  DISPATCH_TASK_STATUS_LABELS,
  EQUIPMENT_TYPE_SHORT,
  LOCATION_TYPE_LABELS,
  type DispatchTaskKind,
} from '#shared/utils/domain'
import { formatContainerNumber } from '#shared/utils/iso6346'

definePageMeta({ layout: 'admin' })
useHead({ title: 'Dispatch' })

interface DispatchBox {
  id: string
  number: string
  containerType: keyof typeof CONTAINER_TYPE_LABELS
  equipmentType: keyof typeof EQUIPMENT_TYPE_SHORT
  isLoaded: boolean
  containerStatus: keyof typeof CONTAINER_STATUS_LABELS
  activePoolState: string
  sealNumber: string | null
  chassisNumber: string | null
  droppedOffAt: string | null
}

interface DispatchSite {
  id: string
  name: string
  type: keyof typeof LOCATION_TYPE_LABELS
  addressLine1: string | null
  city: string | null
  state: string | null
  latitude: number | null
  longitude: number | null
  occupancy: number
  containers: DispatchBox[]
}

interface DispatchDriver {
  id: string
  name: string
  status: string
}

interface OpenTask {
  id: string
  title: string
  kind: keyof typeof DISPATCH_TASK_KIND_LABELS
  status: keyof typeof DISPATCH_TASK_STATUS_LABELS
  driverName?: string | null
}

const { data, status, error, refresh } = await useFetch('/api/admin/dispatch')

const selectedId = ref<string | null>(null)
const taskBox = ref<DispatchBox | null>(null)
const taskKind = ref<DispatchTaskKind>('PICKUP')
const taskDriverId = ref('')
const taskNotes = ref('')
const assigning = ref(false)
const assignError = ref('')
const assignOk = ref('')
const poolQuery = ref('')

const locations = computed(() => (data.value?.locations ?? []) as DispatchSite[])
const drivers = computed(() => (data.value?.drivers ?? []) as DispatchDriver[])
const tasks = computed(() => (data.value?.tasks ?? []) as OpenTask[])

const selected = computed(() => locations.value.find(site => site.id === selectedId.value) ?? null)

const mappedCount = computed(() => locations.value.filter(site => site.latitude != null && site.longitude != null).length)
const poolCount = computed(() => locations.value.reduce((sum, site) => sum + site.occupancy, 0))

const filteredPool = computed(() => {
  const q = poolQuery.value.trim().toLowerCase()
  const boxes = selected.value?.containers ?? []
  if (!q) return boxes
  return boxes.filter((box) => {
    return [
      box.number,
      CONTAINER_TYPE_LABELS[box.containerType],
      EQUIPMENT_TYPE_SHORT[box.equipmentType],
      box.chassisNumber,
    ].some(value => value?.toLowerCase().includes(q))
  })
})

watch(locations, (sites) => {
  if (selectedId.value && sites.some(site => site.id === selectedId.value)) return
  const withBoxes = sites.find(site => site.occupancy > 0 && site.latitude != null)
  selectedId.value = withBoxes?.id ?? sites[0]?.id ?? null
}, { immediate: true })

watch(drivers, (list) => {
  if (taskDriverId.value && list.some(driver => driver.id === taskDriverId.value)) return
  const ready = list.find(driver => driver.status === 'AVAILABLE') ?? list[0]
  taskDriverId.value = ready?.id ?? ''
}, { immediate: true })

watch(selectedId, () => {
  taskBox.value = null
  assignOk.value = ''
  assignError.value = ''
})

function selectSite(id: string) {
  selectedId.value = id
}

function placeLine(site: DispatchSite) {
  return [site.addressLine1, [site.city, site.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
}

function openTask(box: DispatchBox) {
  taskBox.value = box
  taskKind.value = box.isLoaded ? 'DROPOFF' : 'PICKUP'
  assignOk.value = ''
  assignError.value = ''
}

async function assignTask() {
  if (!taskBox.value || !selected.value || !taskDriverId.value || assigning.value) return
  assigning.value = true
  assignError.value = ''
  assignOk.value = ''
  try {
    await $fetch('/api/admin/tasks', {
      method: 'POST',
      body: {
        driverId: taskDriverId.value,
        kind: taskKind.value,
        containerNumber: taskBox.value.number,
        locationId: selected.value.id,
        locationName: selected.value.name,
        notes: taskNotes.value.trim() || undefined,
      },
    })
    const driver = drivers.value.find(item => item.id === taskDriverId.value)
    assignOk.value = `Task sent to ${driver?.name ?? 'the driver'}.`
    taskNotes.value = ''
    taskBox.value = null
    await refresh()
  }
  catch (err) {
    assignError.value = apiErrorMessage(err, 'Could not create that task.')
  }
  finally {
    assigning.value = false
  }
}

const availableDrivers = computed(() => drivers.value.filter(driver => driver.status !== 'INACTIVE'))
</script>

<template>
  <section class="dispatch-board">
    <div class="dispatch-map-col">
      <div class="dispatch-map-hud">
        <div>
          <p class="eyebrow">Dispatch</p>
          <h1>Container pool</h1>
        </div>
        <dl class="dispatch-stats">
          <div>
            <dt>On the map</dt>
            <dd>{{ mappedCount }}</dd>
          </div>
          <div>
            <dt>Boxes</dt>
            <dd>{{ poolCount }}</dd>
          </div>
          <div>
            <dt>Open tasks</dt>
            <dd>{{ tasks.length }}</dd>
          </div>
        </dl>
      </div>

      <p
        v-if="status === 'pending'"
        class="dispatch-map-msg"
        role="status"
      >
        Loading locations…
      </p>
      <p
        v-else-if="error"
        class="dispatch-map-msg err"
        role="alert"
      >
        {{ apiErrorMessage(error, 'Could not load the dispatch board.') }}
      </p>
      <ClientOnly v-else>
        <DispatchBoardMap
          :locations="locations"
          :selected-id="selectedId"
          @select="selectSite"
        />
        <template #fallback>
          <p class="dispatch-map-msg">
            Loading map…
          </p>
        </template>
      </ClientOnly>
    </div>

    <aside
      class="dispatch-panel"
      aria-label="Location detail"
    >
      <template v-if="selected">
        <header class="dispatch-panel-head">
          <p class="eyebrow">{{ LOCATION_TYPE_LABELS[selected.type] }}</p>
          <h2>{{ selected.name }}</h2>
          <p
            v-if="placeLine(selected)"
            class="dispatch-panel-place"
          >
            {{ placeLine(selected) }}
          </p>
          <p class="dispatch-panel-count">
            {{ selected.occupancy }} {{ selected.occupancy === 1 ? 'container' : 'containers' }} on site
          </p>
        </header>

        <label class="dispatch-search">
          <span class="sr-only">Search containers</span>
          <input
            v-model="poolQuery"
            class="input"
            type="search"
            placeholder="Search number, brand, size…"
          >
        </label>

        <div
          v-if="!filteredPool.length"
          class="dispatch-empty"
        >
          {{ selected.occupancy ? 'No containers match that search.' : 'No active containers at this location.' }}
        </div>

        <ul
          v-else
          class="dispatch-pool"
        >
          <li
            v-for="box in filteredPool"
            :key="box.id"
          >
            <button
              type="button"
              class="dispatch-box"
              :class="{ on: taskBox?.id === box.id }"
              @click="openTask(box)"
            >
              <div class="dispatch-box-top">
                <b class="mono">{{ formatContainerNumber(box.number) || box.number }}</b>
                <StatusChip
                  :variant="CONTAINER_STATUS_CHIP[box.containerStatus]"
                  :label="CONTAINER_STATUS_LABELS[box.containerStatus]"
                />
              </div>
              <p>
                {{ EQUIPMENT_TYPE_SHORT[box.equipmentType] }}
                · {{ CONTAINER_TYPE_LABELS[box.containerType] }}
                · {{ box.isLoaded ? 'Loaded' : 'Empty' }}
              </p>
              <p>
                Dropped off {{ formatDateTime(box.droppedOffAt) }}
                <template v-if="box.chassisNumber">
                  · Chassis {{ box.chassisNumber }}
                </template>
              </p>
            </button>
          </li>
        </ul>

        <form
          v-if="taskBox"
          class="dispatch-task"
          @submit.prevent="assignTask"
        >
          <p class="eyebrow">Create task</p>
          <p class="dispatch-task-box mono">
            {{ formatContainerNumber(taskBox.number) || taskBox.number }}
          </p>
          <p
            v-if="assignError"
            class="banner err"
            role="alert"
          >
            {{ assignError }}
          </p>
          <label class="field">
            <span>Work</span>
            <select
              v-model="taskKind"
              class="input"
            >
              <option
                v-for="kind in DISPATCH_TASK_KINDS"
                :key="kind"
                :value="kind"
              >
                {{ DISPATCH_TASK_KIND_LABELS[kind] }}
              </option>
            </select>
          </label>
          <label class="field">
            <span>Driver</span>
            <select
              v-model="taskDriverId"
              class="input"
              required
            >
              <option
                v-if="!availableDrivers.length"
                value=""
              >
                No drivers yet
              </option>
              <option
                v-for="driver in availableDrivers"
                :key="driver.id"
                :value="driver.id"
              >
                {{ driver.name }} · {{ driver.status === 'AVAILABLE' ? 'Available' : driver.status === 'ON_TRIP' ? 'On trip' : 'Off duty' }}
              </option>
            </select>
          </label>
          <label class="field">
            <span>Notes</span>
            <input
              v-model="taskNotes"
              class="input"
              maxlength="200"
              placeholder="Optional — appointment, chassis, gate"
            >
          </label>
          <div class="dispatch-task-actions">
            <button
              class="btn-primary-action"
              type="submit"
              :disabled="assigning || !taskDriverId"
            >
              {{ assigning ? 'Sending…' : 'Send task' }}
            </button>
            <button
              class="btn-ghost"
              type="button"
              @click="taskBox = null"
            >
              Cancel
            </button>
          </div>
        </form>
        <p
          v-else-if="assignOk"
          class="banner ok"
          role="status"
        >
          {{ assignOk }}
        </p>
        <p
          v-else-if="selected.occupancy"
          class="dispatch-hint"
        >
          Tap a container to send a pickup, empty, or drop-off task.
        </p>
      </template>
      <EmptyState
        v-else
        glyph="◫"
        title="No locations yet"
        description="Add a yard or customer with a map pin, then the pool shows up here."
      />

      <section
        v-if="tasks.length"
        class="dispatch-tasks"
      >
        <h3>Open tasks</h3>
        <ul>
          <li
            v-for="task in tasks"
            :key="task.id"
          >
            <p class="dispatch-task-title">
              {{ task.title }}
            </p>
            <p>
              {{ task.driverName || 'Driver' }}
              · {{ DISPATCH_TASK_KIND_LABELS[task.kind] }}
            </p>
            <StatusChip
              :variant="DISPATCH_TASK_STATUS_CHIP[task.status]"
              :label="DISPATCH_TASK_STATUS_LABELS[task.status]"
            />
          </li>
        </ul>
      </section>
    </aside>
  </section>
</template>
