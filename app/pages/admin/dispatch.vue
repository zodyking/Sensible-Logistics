<script setup lang="ts">
import { emptyDispatchCard, type DispatchCard } from '#shared/utils/dispatch-cards'
import { addIsoDays } from '#shared/utils/sms-task'

definePageMeta({ layout: 'admin' })
useHead({ title: 'Dispatch' })

const route = useRoute()
const router = useRouter()

const driverId = computed({
  get: () => (typeof route.query.driver === 'string' ? route.query.driver : ''),
  set: (value: string) => {
    void router.replace({ query: { ...route.query, driver: value || undefined } })
  },
})

const workDate = computed({
  get: () => (typeof route.query.date === 'string' ? route.query.date : ''),
  set: (value: string) => {
    void router.replace({ query: { ...route.query, date: value || undefined } })
  },
})

const { data, status, error, refresh } = await useFetch('/api/admin/plans', {
  query: computed(() => ({
    driverId: driverId.value || undefined,
    date: workDate.value || undefined,
  })),
})

const driverQuery = ref('')
const cards = ref<DispatchCard[]>([])
const saving = ref<'draft' | 'submit' | null>(null)
const actionError = ref('')
const flash = ref('')
const bulkLocationId = ref<string | null>(null)
const bulkSelected = ref<string[]>([])
const loadedKey = ref('')

const todayIso = computed(() => data.value?.todayIso ?? '')
const drivers = computed(() => data.value?.drivers ?? [])
const locations = computed(() => data.value?.locations ?? [])
const trips = computed(() => data.value?.trips ?? [])
const mode = computed(() => data.value?.mode ?? 'edit')
const planStatus = computed(() => data.value?.planStatus ?? 'empty')
const selectedDriver = computed(() => data.value?.driver ?? null)

const filteredDrivers = computed(() => {
  const q = driverQuery.value.trim().toLowerCase()
  if (!q) return drivers.value
  return drivers.value.filter(driver => driver.name.toLowerCase().includes(q))
})

const bulkLocation = computed(() => locations.value.find(site => site.id === bulkLocationId.value) ?? null)

watch(() => data.value, (desk) => {
  if (!desk) return
  const key = `${desk.driver?.id ?? ''}:${desk.workDate}:${desk.planStatus}`
  if (loadedKey.value === key && cards.value.length) return
  loadedKey.value = key
  cards.value = desk.mode === 'edit'
    ? desk.tasks.filter(task => task.assigned).map(task => ({ ...task.card, id: task.id }))
    : []
  if (!driverId.value && desk.driver) driverId.value = desk.driver.id
  if (!workDate.value) workDate.value = desk.workDate
}, { immediate: true })

const dirty = computed(() => {
  const saved = (data.value?.tasks ?? []).filter(task => task.assigned).map(task => task.card)
  return JSON.stringify(cards.value) !== JSON.stringify(saved)
})

function shiftDate(days: number) {
  const iso = workDate.value || todayIso.value
  if (!iso) return
  workDate.value = addIsoDays(iso, days)
  loadedKey.value = ''
}

function setToday() {
  workDate.value = todayIso.value
  loadedKey.value = ''
}

function addCard() {
  cards.value = [...cards.value, emptyDispatchCard(cards.value.length ? cards.value[cards.value.length - 1]!.kind : 'PICKUP')]
}

function removeCard(index: number) {
  cards.value = cards.value.filter((_, i) => i !== index)
}

function moveCard(index: number, direction: -1 | 1) {
  const next = index + direction
  if (next < 0 || next >= cards.value.length) return
  const copy = cards.value.slice()
  const [item] = copy.splice(index, 1)
  copy.splice(next, 0, item!)
  cards.value = copy
}

function toggleBulk(id: string) {
  bulkSelected.value = bulkSelected.value.includes(id)
    ? bulkSelected.value.filter(item => item !== id)
    : [...bulkSelected.value, id]
}

function addSelectedBoxes() {
  const site = bulkLocation.value
  if (!site) return
  const picked = site.containers.filter(box => bulkSelected.value.includes(box.id))
  if (!picked.length) return
  const next = cards.value.slice()
  for (const box of picked) {
    const card = emptyDispatchCard('PICKUP')
    card.locationId = site.id
    card.locationName = site.name
    card.containerId = box.id
    card.containerNumber = box.number
    card.containerPending = false
    next.push(card)
  }
  cards.value = next
  bulkSelected.value = []
}

async function save(action: 'draft' | 'submit') {
  if (!selectedDriver.value || saving.value) return
  saving.value = action
  actionError.value = ''
  flash.value = ''
  try {
    const wasSubmitted = planStatus.value === 'submitted'
    const result = await $fetch('/api/admin/plans', {
      method: 'PUT',
      body: {
        driverId: selectedDriver.value.id,
        workDate: workDate.value || todayIso.value,
        action,
        cards: cards.value,
      },
    })
    data.value = result.desk
    loadedKey.value = `${result.desk.driver?.id ?? ''}:${result.desk.workDate}:${result.desk.planStatus}`
    cards.value = result.desk.tasks.filter(task => task.assigned).map(task => ({ ...task.card, id: task.id }))
    const name = selectedDriver.value.name
    if (action === 'draft') flash.value = `Draft saved for ${name}.`
    else if (result.emailed) flash.value = wasSubmitted
      ? `Updated work sent to ${name}.`
      : `Work sent to ${name}.`
    else flash.value = `Work saved for ${name}.`
    await refresh()
  }
  catch (err) {
    actionError.value = apiErrorMessage(err, 'Could not save that day’s work.')
  }
  finally {
    saving.value = null
  }
}

function driverStatusLabel(value: string) {
  if (value === 'AVAILABLE') return 'Available'
  if (value === 'ON_TRIP') return 'On trip'
  return 'Off duty'
}

watch(driverId, () => {
  loadedKey.value = ''
  bulkSelected.value = []
})

watch(workDate, () => {
  loadedKey.value = ''
  bulkSelected.value = []
})
</script>

<template>
  <div class="desk">
    <div class="a-head desk-head">
      <div>
        <span class="eyebrow">Operations</span>
        <h1>Dispatch</h1>
      </div>
      <p class="text-sm text-[var(--color-ink-500)]">
        Assign a day’s work, or review what already ran.
      </p>
    </div>

    <p
      v-if="error"
      class="banner err"
      role="alert"
    >
      {{ apiErrorMessage(error, 'Could not load dispatch.') }}
    </p>
    <p
      v-else-if="actionError"
      class="banner err"
      role="alert"
    >
      {{ actionError }}
    </p>
    <p
      v-else-if="flash"
      class="banner ok"
      role="status"
    >
      {{ flash }}
    </p>

    <div class="desk-shell">
      <aside
        class="desk-rail"
        aria-label="Drivers"
      >
        <label class="searchbar">
          <span class="sr-only">Search drivers</span>
          <span aria-hidden="true">⌕</span>
          <input
            v-model="driverQuery"
            type="search"
            placeholder="Search drivers"
          >
        </label>
        <ul class="desk-drivers">
          <li
            v-for="driver in filteredDrivers"
            :key="driver.id"
          >
            <button
              type="button"
              class="desk-driver"
              :class="{ on: selectedDriver?.id === driver.id }"
              @click="driverId = driver.id"
            >
              <b>{{ driver.name }}</b>
              <span>{{ driverStatusLabel(driver.status) }}</span>
            </button>
          </li>
        </ul>
        <p
          v-if="!filteredDrivers.length"
          class="desk-hint"
        >
          No drivers match that search.
        </p>
      </aside>

      <section class="desk-main">
        <div class="desk-datebar">
          <div>
            <p class="eyebrow">
              {{ selectedDriver?.name || 'Select a driver' }}
            </p>
            <h2>{{ workDate ? formatDayHeading(workDate, todayIso) : 'Pick a day' }}</h2>
          </div>
          <div class="desk-date-nav">
            <button
              type="button"
              class="btn-ghost"
              aria-label="Previous day"
              @click="shiftDate(-1)"
            >
              ‹
            </button>
            <input
              :value="workDate || todayIso"
              class="input desk-date"
              type="date"
              @change="workDate = ($event.target as HTMLInputElement).value"
            >
            <button
              type="button"
              class="btn-ghost"
              aria-label="Next day"
              @click="shiftDate(1)"
            >
              ›
            </button>
            <button
              type="button"
              class="btn-ghost"
              :disabled="workDate === todayIso"
              @click="setToday"
            >
              Today
            </button>
          </div>
        </div>

        <p
          v-if="status === 'pending' && !data"
          class="desk-hint"
        >
          Loading…
        </p>

        <template v-else-if="selectedDriver">
          <div
            v-if="mode === 'history'"
            class="desk-history"
          >
            <p class="section-label">
              <span>Trips</span>
              <span>{{ trips.length }}</span>
            </p>
            <div
              v-if="trips.length"
              class="desk-trips"
            >
              <TripHistoryCard
                v-for="trip in trips"
                :key="trip.id"
                :to="`/trips/${trip.id}`"
                :status="trip.status"
                :reference="trip.reference"
                :origin-name="trip.originName"
                :destination-name="trip.destinationName"
                :picked-up-at="trip.pickedUpAt"
                :dropped-off-at="trip.droppedOffAt"
                :container-number="trip.containerNumber"
                :container-type="trip.containerType"
                :chassis-number="trip.chassisNumber"
                :kind="trip.kind"
                :is-loaded="trip.isLoaded"
                :created-at="trip.createdAt"
              />
            </div>
            <EmptyState
              v-else
              glyph="☰"
              title="No trips this day"
              description="Pickup and drop-off history for this driver will show here."
            />

            <p class="section-label">
              <span>Tasks</span>
              <span>{{ data?.tasks.length ?? 0 }}</span>
            </p>
            <DispatchTaskCard
              v-for="task in data?.tasks ?? []"
              :id="task.id"
              :key="task.id"
              :title="task.title"
              :raw-text="task.rawText"
              :sender="task.sender"
              :received-at="task.receivedAt"
              :work-date="task.workDate"
              :kind="task.kind"
              :status="task.status"
              :source="task.source"
              :assigned="task.assigned"
              :card="task.card"
              :steps="task.steps"
              :trip-id="task.tripId"
            />
            <EmptyState
              v-if="!(data?.tasks.length)"
              glyph="☰"
              title="No tasks this day"
              description="Assigned work and the driver’s own notes will show here."
            />
          </div>

          <template v-else>
            <div
              v-if="planStatus === 'submitted'"
              class="desk-status"
            >
              <StatusChip
                variant="ok"
                label="Sent to driver"
              />
              <span>Edits here notify {{ selectedDriver.name }} by email.</span>
            </div>
            <div
              v-else-if="planStatus === 'draft'"
              class="desk-status"
            >
              <StatusChip
                variant="idle"
                label="Draft"
              />
              <span>The driver cannot see this until you submit.</span>
            </div>

            <div class="desk-bulk card">
              <p class="eyebrow">
                Add from a location
              </p>
              <label class="field">
                <span>Location</span>
                <select
                  class="input"
                  :value="bulkLocationId ?? ''"
                  @change="bulkLocationId = ($event.target as HTMLSelectElement).value || null"
                >
                  <option value="">
                    Choose a yard, customer, or terminal
                  </option>
                  <option
                    v-for="site in locations"
                    :key="site.id"
                    :value="site.id"
                  >
                    {{ site.name }} · {{ site.containers.length }}
                  </option>
                </select>
              </label>
              <ul
                v-if="bulkLocation?.containers.length"
                class="desk-bulk-list"
              >
                <li
                  v-for="box in bulkLocation.containers"
                  :key="box.id"
                >
                  <label class="desk-check">
                    <input
                      type="checkbox"
                      :checked="bulkSelected.includes(box.id)"
                      @change="toggleBulk(box.id)"
                    >
                    <span class="mono">{{ box.number }}</span>
                    <small>{{ box.isLoaded ? 'Loaded' : 'Empty' }}</small>
                  </label>
                </li>
              </ul>
              <p
                v-else-if="bulkLocation"
                class="desk-hint"
              >
                Nothing on site. Add a card and mark the container as not in the system yet.
              </p>
              <button
                type="button"
                class="btn-ghost"
                :disabled="!bulkSelected.length"
                @click="addSelectedBoxes"
              >
                Add {{ bulkSelected.length || '' }} selected
              </button>
            </div>

            <DispatchPlanCard
              v-for="(card, index) in cards"
              :key="card.id"
              v-model="cards[index]"
              :index="index"
              :locations="locations"
              :can-move-up="index > 0"
              :can-move-down="index < cards.length - 1"
              @remove="removeCard(index)"
              @move="(direction) => moveCard(index, direction)"
            />

            <button
              type="button"
              class="desk-add"
              @click="addCard"
            >
              Add a task card
            </button>

            <div
              v-if="trips.length"
              class="desk-side-history"
            >
              <p class="section-label">
                <span>Trips this day</span>
                <span>{{ trips.length }}</span>
              </p>
              <TripHistoryCard
                v-for="trip in trips"
                :key="trip.id"
                :to="`/trips/${trip.id}`"
                :status="trip.status"
                :reference="trip.reference"
                :origin-name="trip.originName"
                :destination-name="trip.destinationName"
                :picked-up-at="trip.pickedUpAt"
                :dropped-off-at="trip.droppedOffAt"
                :container-number="trip.containerNumber"
                :container-type="trip.containerType"
                :chassis-number="trip.chassisNumber"
                :kind="trip.kind"
                :is-loaded="trip.isLoaded"
                :created-at="trip.createdAt"
              />
            </div>

            <div class="desk-actions">
              <button
                v-if="planStatus !== 'submitted'"
                type="button"
                class="btn-ghost"
                :disabled="Boolean(saving) || !dirty"
                @click="save('draft')"
              >
                {{ saving === 'draft' ? 'Saving…' : 'Save draft' }}
              </button>
              <button
                type="button"
                class="btn-primary-action"
                :disabled="Boolean(saving) || !cards.length || (planStatus === 'submitted' && !dirty)"
                @click="save('submit')"
              >
                {{ saving === 'submit'
                  ? 'Sending…'
                  : (planStatus === 'submitted' ? 'Save and notify driver' : 'Submit to driver') }}
              </button>
            </div>
          </template>
        </template>

        <EmptyState
          v-else
          glyph="☰"
          title="No drivers yet"
          description="Add a driver, then you can assign a day’s work here."
        />
      </section>
    </div>
  </div>
</template>
