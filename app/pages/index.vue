<script setup lang="ts">
import {
  DOCUMENT_CATEGORY_LABELS,
  LOCATION_GLYPH,
  LOCATION_TYPE_LABELS,
  TRIP_STATUS_LABELS,
} from '#shared/utils/domain'
import type { DocumentCategory } from '#shared/utils/domain'
import { greetingForHour } from '#shared/utils/workflow'

useHead({ title: 'Home' })

const { data, status, error, refresh } = await useFetch('/api/home')

const pendingSync = useState('pending-sync', () => 0)
watchEffect(() => {
  pendingSync.value = (data.value?.pendingSync.events ?? 0) + (data.value?.pendingSync.photos ?? 0)
})

const greeting = computed(() => greetingForHour(new Date().getHours()))
const phase = computed(() => data.value?.phase ?? 'idle')
const connected = computed(() => data.value?.connected)
const active = computed(() => data.value?.active)
const board = computed(() => data.value?.boardLocation ?? data.value?.homeYard)
const heroContainer = computed(() => connected.value?.container ?? active.value?.container ?? null)

type Sheet = 'dropoff' | 'documents' | 'sms' | 'contacts' | 'connect' | 'swap' | 'arrive' | 'depart' | null
const sheet = ref<Sheet>(null)
const connectLoaded = ref(false)
const locationSearch = ref('')
const selectedDestinationId = ref<string | null>(null)
const selectedPickupId = ref<string | null>(null)
const busy = ref(false)
const actionError = ref('')
const uploadingCategory = ref<DocumentCategory | null>(null)

const { data: locationData } = await useFetch('/api/locations', {
  query: computed(() => ({ q: locationSearch.value || undefined, limit: 50 })),
})

watch(active, (value) => {
  selectedDestinationId.value = value?.destination?.id ?? null
}, { immediate: true })

const filteredLocations = computed(() => locationData.value?.items ?? [])
const connectList = computed(() =>
  connectLoaded.value ? (data.value?.inventory.loads ?? []) : (data.value?.inventory.empties ?? []),
)
const swapList = computed(() => data.value?.inventory.counterpart ?? [])
const documentPrompt = computed(() => data.value?.documentPrompt)

const primaryAction = computed(() => data.value?.nextActions[0] ?? null)
const secondaryAction = computed(() => data.value?.nextActions[1] ?? null)

watch(sheet, (value) => {
  if (value) actionError.value = ''
})

function openConnect(loaded: boolean) {
  connectLoaded.value = loaded
  sheet.value = 'connect'
}

function runAction(kind: string | undefined) {
  if (!kind) return
  if (kind === 'connect_empty') openConnect(false)
  else if (kind === 'connect_load') openConnect(true)
  else if (kind === 'swap') sheet.value = 'swap'
  else if (kind === 'depart') sheet.value = 'depart'
  else if (kind === 'arrive') {
    if (active.value?.destination?.id) void arrive(active.value.destination.id)
    else sheet.value = 'arrive'
  }
  else if (kind === 'documents') sheet.value = 'documents'
  else if (kind === 'dropoff' && active.value?.trip.id) {
    navigateTo(`/trips/${active.value.trip.id}`)
  }
}

async function connectTo(containerId: string) {
  if (!board.value || busy.value) return
  busy.value = true
  actionError.value = ''
  try {
    await $fetch('/api/moves/connect', {
      method: 'POST',
      body: {
        eventId: crypto.randomUUID(),
        containerId,
        locationId: board.value.id,
      },
    })
    sheet.value = null
    await refresh()
  }
  catch (err) {
    actionError.value = apiErrorMessage(err, 'Could not connect to that container.')
  }
  finally {
    busy.value = false
  }
}

async function depart() {
  if (busy.value) return
  busy.value = true
  actionError.value = ''
  try {
    await $fetch('/api/moves/depart', {
      method: 'POST',
      body: {
        eventId: crypto.randomUUID(),
        destinationLocationId: selectedDestinationId.value,
      },
    })
    sheet.value = null
    await refresh()
  }
  catch (err) {
    actionError.value = apiErrorMessage(err, 'Could not depart.')
  }
  finally {
    busy.value = false
  }
}

async function arrive(locationId: string) {
  if (!active.value || busy.value) return
  busy.value = true
  actionError.value = ''
  try {
    await $fetch(`/api/trips/${active.value.trip.id}/arrive`, {
      method: 'POST',
      body: { eventId: crypto.randomUUID(), locationId },
    })
    sheet.value = null
    await refresh()
  }
  catch (err) {
    actionError.value = apiErrorMessage(err, 'Could not mark arrival.')
  }
  finally {
    busy.value = false
  }
}

async function swap() {
  if (!selectedPickupId.value || !board.value || busy.value) return
  busy.value = true
  actionError.value = ''
  try {
    const result = await $fetch('/api/moves/swap', {
      method: 'POST',
      body: {
        eventId: crypto.randomUUID(),
        pickupContainerId: selectedPickupId.value,
        locationId: board.value.id,
      },
    })
    selectedPickupId.value = null
    sheet.value = 'documents'
    await refresh()
    if (result.documentPrompt) sheet.value = 'documents'
  }
  catch (err) {
    actionError.value = apiErrorMessage(err, 'Could not complete the swap.')
  }
  finally {
    busy.value = false
  }
}

async function saveDropoff() {
  if (!active.value || !selectedDestinationId.value) return
  busy.value = true
  actionError.value = ''
  try {
    await $fetch(`/api/trips/${active.value.trip.id}/destination`, {
      method: 'POST',
      body: { destinationLocationId: selectedDestinationId.value },
    })
    sheet.value = null
    await refresh()
  }
  catch (err) {
    actionError.value = apiErrorMessage(err, 'Could not change drop-off.')
  }
  finally {
    busy.value = false
  }
}

async function uploadDocument(category: DocumentCategory, file: File) {
  const prompt = documentPrompt.value
  if (!prompt?.containerId || uploadingCategory.value) return
  uploadingCategory.value = category
  actionError.value = ''
  try {
    const body = new FormData()
    body.append('file', file)
    body.append('category', category)
    body.append('containerId', prompt.containerId)
    if (prompt.tripId) body.append('tripId', prompt.tripId)
    if (board.value?.id) body.append('locationId', board.value.id)
    await $fetch('/api/documents', { method: 'POST', body })
    await refresh()
  }
  catch (err) {
    actionError.value = apiErrorMessage(err, 'Could not upload that file.')
  }
  finally {
    uploadingCategory.value = null
  }
}

function onFilePicked(category: DocumentCategory, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) void uploadDocument(category, file)
}

function occupancyLabel(item: { occupancy?: number, capacity?: number | null }) {
  if (item.occupancy == null) return '—'
  if (item.capacity) return `${item.occupancy} / ${item.capacity}`
  return `${item.occupancy} boxes`
}
</script>

<template>
  <section class="d-page">
    <div
      v-if="status === 'pending'"
      class="card p-6 text-center text-sm text-[var(--color-ink-500)]"
      role="status"
    >
      Loading your day…
    </div>

    <p
      v-else-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>
        <b>Could not load the dashboard</b>
        {{ apiErrorMessage(error) }}
      </span>
    </p>

    <template v-else-if="data">
      <header class="dash-hello">
        <p class="eyebrow">
          {{ data.driver.company }}
        </p>
        <h1 class="d-title dash-title">
          {{ greeting }}, {{ data.driver.firstName }}
        </h1>
        <div class="dash-duty">
          <span
            class="chip"
            :class="data.duty.isOnDuty ? 'transit' : 'idle'"
          >
            {{ data.duty.isOnDuty ? 'On duty' : 'Off duty' }}
          </span>
          <span v-if="data.duty.isOnDuty">{{ formatHours(data.duty.onDutyMinutes) }}</span>
          <span>{{ board?.name ?? 'Company yard' }}</span>
        </div>
      </header>

      <div
        class="dash-stats"
        aria-label="Yard snapshot"
      >
        <div>
          <b>{{ data.yardStats.empties }}</b>
          <small>Empties here</small>
        </div>
        <div>
          <b>{{ data.yardStats.loads }}</b>
          <small>Loads here</small>
        </div>
        <div>
          <b>{{ data.todayMoves.length }}</b>
          <small>Moves today</small>
        </div>
      </div>

      <p
        v-if="documentPrompt?.missing?.length"
        class="banner warn"
        role="status"
      >
        <span aria-hidden="true">!</span>
        <span>
          <b>Documents needed after the swap</b>
          {{ documentPrompt.missing.map(category => DOCUMENT_CATEGORY_LABELS[category]).join(', ') }}
          at {{ documentPrompt.locationName ?? 'this stop' }}.
          <button
            type="button"
            class="banner-link"
            @click="sheet = 'documents'"
          >
            Upload now
          </button>
        </span>
      </p>

      <template v-if="heroContainer">
        <TripCard
          :container-type="heroContainer.containerType"
          :is-loaded="heroContainer.isLoaded"
          :container-number="heroContainer.number"
          :equipment-type="heroContainer.equipmentType"
          :chassis-number="connected?.chassis?.number ?? active?.chassis?.number"
          :seal-number="heroContainer.sealNumber ?? active?.trip.sealNumber"
          :origin-name="connected?.location?.name ?? active?.origin?.name"
          :destination-name="active?.destination?.name ?? (phase === 'connected' ? 'Set when you depart' : null)"
          :origin-label="phase === 'in_transit' ? 'Origin' : 'Currently at'"
          :destination-label="phase === 'in_transit' || phase === 'at_stop' ? 'Drop-off' : 'Next stop'"
          :can-change-dropoff="Boolean(active?.trip)"
          :status-label="connected?.statusLabel ?? (phase === 'in_transit' ? 'In transit' : null)"
          :status-hint="phase === 'connected'
            ? 'Hooked from the prior stop or overnight — not a live move yet.'
            : phase === 'at_stop'
              ? 'Arrived. Swap both boxes here, or drop this one off.'
              : null"
          @change-dropoff="sheet = 'dropoff'"
        />
      </template>

      <div
        v-else
        class="trip-card dash-ready"
      >
        <div class="trip-card-head">
          <div class="trip-card-meta">
            <span class="trip-flag line">Ready</span>
            <span class="trip-flag empty">No hook</span>
          </div>
          <div class="trip-cno">
            Start at the yard
          </div>
          <p class="dash-ready-copy">
            No active move. Connect to an empty or a load at
            {{ data.homeYard?.name ?? 'the company yard' }}, then swap at a CSX yard,
            marine terminal or customer.
          </p>
        </div>
      </div>

      <div class="home-actions">
        <button
          type="button"
          @click="sheet = 'documents'"
        >
          <span
            class="act-ico"
            aria-hidden="true"
          >▤</span>
          Documents
        </button>
        <button
          type="button"
          @click="sheet = 'sms'"
        >
          <span
            class="act-ico"
            aria-hidden="true"
          >✉</span>
          Send SMS
        </button>
        <button
          type="button"
          @click="sheet = 'contacts'"
        >
          <span
            class="act-ico"
            aria-hidden="true"
          >☎</span>
          Contacts
        </button>
        <NuxtLink :to="active ? `/trips/${active.trip.id}` : '/pickups'">
          <span
            class="act-ico"
            aria-hidden="true"
          >☰</span>
          Trip Details
        </NuxtLink>
      </div>

      <div class="dash-ctas">
        <button
          v-if="primaryAction && !primaryAction.to"
          type="button"
          class="btn-primary-action home-cta"
          :disabled="busy"
          @click="runAction(primaryAction.kind)"
        >
          {{ primaryAction.label }}
        </button>
        <NuxtLink
          v-else-if="primaryAction?.to"
          :to="primaryAction.to"
          class="btn-primary-action home-cta"
        >
          {{ primaryAction.label }}
        </NuxtLink>

        <button
          v-if="secondaryAction && !secondaryAction.to"
          type="button"
          class="btn-dark home-cta"
          :disabled="busy"
          @click="runAction(secondaryAction.kind)"
        >
          {{ secondaryAction.label }}
        </button>
        <NuxtLink
          v-else-if="secondaryAction?.to"
          :to="secondaryAction.to"
          class="btn-dark home-cta"
        >
          {{ secondaryAction.label }}
        </NuxtLink>
      </div>

      <div class="section-label">
        <span>Where work happens</span>
        <NuxtLink to="/containers">
          All locations
        </NuxtLink>
      </div>

      <div class="dash-lanes">
        <NuxtLink
          v-for="lane in data.lanes"
          :key="lane.id"
          class="loc-card"
          :to="lane.locations[0] ? `/containers?locationId=${lane.locations[0].id}` : '/containers'"
        >
          <div class="loc-top">
            <span
              class="loc-glyph"
              aria-hidden="true"
            >{{ LOCATION_GLYPH[lane.locations[0]?.type ?? 'COMPANY_YARD'] }}</span>
            <div class="loc-main">
              <b>{{ lane.title }}</b>
              <small>{{ lane.blurb }}</small>
            </div>
          </div>
          <div class="loc-occ">
            <small>{{ lane.count }} boxes · {{ lane.locations.length || 'No' }} sites</small>
          </div>
          <ul
            v-if="lane.locations.length"
            class="dash-lane-sites"
          >
            <li
              v-for="site in lane.locations.slice(0, 2)"
              :key="site.id"
            >
              {{ site.name }}
              <span>{{ occupancyLabel(site) }}</span>
            </li>
          </ul>
        </NuxtLink>
      </div>

      <div class="section-label">
        <span>Today’s work</span>
        <NuxtLink to="/pickups">
          All trips
        </NuxtLink>
      </div>

      <div
        v-if="data.todayMoves.length"
        class="card rowlist"
      >
        <NuxtLink
          v-for="move in data.todayMoves"
          :key="move.id"
          class="row"
          :to="`/trips/${move.id}`"
        >
          <span
            class="row-ico"
            aria-hidden="true"
          >▸</span>
          <span class="row-main">
            <b class="mono">{{ move.containerNumber ?? move.reference }}</b>
            <small>
              {{ move.originName ?? '—' }} → {{ move.destinationName ?? '—' }}
            </small>
          </span>
          <span class="row-end">
            {{ TRIP_STATUS_LABELS[move.status] }}
            <small>{{ formatTime(move.completedAt ?? move.pickedUpAt ?? move.createdAt) }}</small>
          </span>
        </NuxtLink>
      </div>
      <EmptyState
        v-else
        glyph="▸"
        title="No moves yet today"
        description="Connect at the yard, depart, then swap at rail, marine or customer."
      />
    </template>

    <BottomSheet
      :open="sheet === 'connect'"
      :title="connectLoaded ? 'Connect to a load' : 'Connect to an empty'"
      @close="sheet = null"
    >
      <p
        v-if="actionError"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ actionError }}</span>
      </p>
      <p class="sheet-lead">
        Hooking here keeps the box at {{ board?.name }}. Status will read
        <b>Connected to {{ data?.driver.name }}</b> until you depart.
      </p>
      <button
        v-for="item in connectList"
        :key="item.id"
        type="button"
        class="sheet-loc"
        :disabled="busy"
        @click="connectTo(item.id)"
      >
        <b class="mono">{{ item.number }}</b>
        <small>{{ item.isLoaded ? 'Load' : 'Empty' }} · {{ item.equipmentType.replace('_', ' ') }}</small>
      </button>
      <p
        v-if="!connectList.length"
        class="text-sm text-[var(--color-ink-500)]"
      >
        No {{ connectLoaded ? 'loads' : 'empties' }} sitting at this location.
      </p>
      <div class="sheet-actions">
        <button
          type="button"
          class="btn-cancel"
          @click="sheet = null"
        >
          Cancel
        </button>
      </div>
    </BottomSheet>

    <BottomSheet
      :open="sheet === 'swap'"
      title="Swap"
      @close="sheet = null"
    >
      <p
        v-if="actionError"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ actionError }}</span>
      </p>
      <p class="sheet-lead">
        Drop {{ heroContainer?.number ?? 'the hooked box' }}
        ({{ heroContainer?.isLoaded ? 'load' : 'empty' }}) and pick the other
        at the same time. Documents are requested right after.
      </p>
      <button
        v-for="item in swapList"
        :key="item.id"
        type="button"
        class="sheet-loc"
        :class="{ sel: selectedPickupId === item.id }"
        @click="selectedPickupId = item.id"
      >
        <b class="mono">{{ item.number }}</b>
        <small>{{ item.isLoaded ? 'Load' : 'Empty' }} · {{ item.sealNumber ? `Seal ${item.sealNumber}` : 'No seal' }}</small>
      </button>
      <p
        v-if="!swapList.length"
        class="text-sm text-[var(--color-ink-500)]"
      >
        Nothing to swap onto at this location.
      </p>
      <div class="sheet-actions">
        <button
          type="button"
          class="btn-cancel"
          @click="sheet = null"
        >
          Cancel
        </button>
        <button
          type="button"
          class="btn-save"
          :disabled="!selectedPickupId || busy"
          @click="swap"
        >
          {{ busy ? 'Swapping…' : 'Confirm swap' }}
        </button>
      </div>
    </BottomSheet>

    <BottomSheet
      :open="sheet === 'depart'"
      title="Depart"
      @close="sheet = null"
    >
      <p
        v-if="actionError"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ actionError }}</span>
      </p>
      <p class="sheet-lead">
        Leave {{ connected?.location?.name ?? 'this location' }} with
        {{ heroContainer?.number }}. Choose a destination now or at arrival.
      </p>
      <div class="sheet-search">
        ⌕
        <input
          v-model="locationSearch"
          type="search"
          placeholder="Search rail, marine, yards, customers…"
          aria-label="Search destination"
        >
      </div>
      <button
        v-for="location in filteredLocations"
        :key="location.id"
        type="button"
        class="sheet-loc"
        :class="{ sel: selectedDestinationId === location.id }"
        @click="selectedDestinationId = location.id"
      >
        <b>{{ location.name }}</b>
        <small>{{ LOCATION_TYPE_LABELS[location.type] }}</small>
      </button>
      <div class="sheet-actions">
        <button
          type="button"
          class="btn-cancel"
          @click="sheet = null"
        >
          Cancel
        </button>
        <button
          type="button"
          class="btn-save"
          :disabled="busy"
          @click="depart"
        >
          {{ busy ? 'Departing…' : selectedDestinationId ? 'Depart' : 'Depart without destination' }}
        </button>
      </div>
    </BottomSheet>

    <BottomSheet
      :open="sheet === 'arrive'"
      title="Where did you arrive?"
      @close="sheet = null"
    >
      <p
        v-if="actionError"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ actionError }}</span>
      </p>
      <div class="sheet-search">
        ⌕
        <input
          v-model="locationSearch"
          type="search"
          placeholder="Search locations…"
          aria-label="Search arrival location"
        >
      </div>
      <button
        v-for="location in filteredLocations"
        :key="location.id"
        type="button"
        class="sheet-loc"
        @click="arrive(location.id)"
      >
        <b>{{ location.name }}</b>
        <small>{{ LOCATION_TYPE_LABELS[location.type] }}</small>
      </button>
      <div class="sheet-actions">
        <button
          type="button"
          class="btn-cancel"
          @click="sheet = null"
        >
          Cancel
        </button>
      </div>
    </BottomSheet>

    <BottomSheet
      :open="sheet === 'dropoff'"
      title="Change drop-off location"
      @close="sheet = null"
    >
      <p
        v-if="actionError"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ actionError }}</span>
      </p>
      <div class="sheet-search">
        ⌕
        <input
          v-model="locationSearch"
          type="search"
          placeholder="Search yards, customers, terminals…"
          aria-label="Search drop-off locations"
        >
      </div>
      <button
        v-for="location in filteredLocations"
        :key="location.id"
        type="button"
        class="sheet-loc"
        :class="{ sel: selectedDestinationId === location.id }"
        @click="selectedDestinationId = location.id"
      >
        <b>{{ location.name }}</b>
        <small>
          {{ LOCATION_TYPE_LABELS[location.type] }}
          <template v-if="location.addressLine1"> · {{ location.addressLine1 }}</template>
          <template v-if="location.city"> · {{ location.city }}</template>
        </small>
      </button>
      <div class="sheet-actions">
        <button
          type="button"
          class="btn-cancel"
          @click="sheet = null"
        >
          Cancel
        </button>
        <button
          type="button"
          class="btn-save"
          :disabled="!selectedDestinationId || busy"
          @click="saveDropoff"
        >
          {{ busy ? 'Saving…' : 'Save location' }}
        </button>
      </div>
    </BottomSheet>

    <BottomSheet
      :open="sheet === 'documents'"
      title="Trip documents"
      @close="sheet = null"
    >
      <p
        v-if="actionError"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ actionError }}</span>
      </p>
      <p class="sheet-lead">
        Capture interchange paper at the swap — rail TIR/EIR, marine EIR, or
        customer POD. Photos count.
      </p>
      <ul class="doc-check">
        <li
          v-for="item in (documentPrompt?.checklist ?? [
            { category: 'EIR' as const, label: DOCUMENT_CATEGORY_LABELS.EIR, required: false, hint: 'Attach when object storage is used on a trip.' },
            { category: 'PHOTO' as const, label: DOCUMENT_CATEGORY_LABELS.PHOTO, required: false, hint: 'Yard or gate photos.' },
          ])"
          :key="item.category"
        >
          <div>
            <b>{{ item.label }}</b>
            <small>{{ item.hint }}</small>
          </div>
          <span
            v-if="documentPrompt?.uploaded?.includes(item.category)"
            class="chip ok"
          >On file</span>
          <label
            v-else
            class="doc-upload"
          >
            <input
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              :disabled="uploadingCategory === item.category || !documentPrompt?.containerId"
              :aria-label="`Upload ${item.label}`"
              @change="onFilePicked(item.category, $event)"
            >
            {{ uploadingCategory === item.category ? 'Uploading…' : item.required ? 'Required' : 'Upload' }}
          </label>
        </li>
      </ul>
      <p
        v-if="!documentPrompt?.containerId"
        class="text-sm text-[var(--color-ink-500)]"
      >
        Documents attach after you connect or swap. Complete a swap to open the checklist for this stop.
      </p>
      <div class="sheet-actions">
        <button
          type="button"
          class="btn-cancel"
          @click="sheet = null"
        >
          {{ documentPrompt?.missing?.length ? 'Later' : 'Close' }}
        </button>
      </div>
    </BottomSheet>

    <BottomSheet
      :open="sheet === 'sms'"
      title="Send SMS"
      @close="sheet = null"
    >
      <p class="text-sm text-[var(--color-ink-500)]">
        Dispatch SMS from this trip is not wired yet. Use your phone’s messages app for now.
      </p>
      <div class="sheet-actions">
        <button
          type="button"
          class="btn-cancel"
          @click="sheet = null"
        >
          Close
        </button>
      </div>
    </BottomSheet>

    <BottomSheet
      :open="sheet === 'contacts'"
      title="Contacts"
      @close="sheet = null"
    >
      <p class="text-sm text-[var(--color-ink-500)]">
        Terminal, customer and dispatch contacts will live here. None are on file for this stop yet.
      </p>
      <div class="sheet-actions">
        <button
          type="button"
          class="btn-cancel"
          @click="sheet = null"
        >
          Close
        </button>
      </div>
    </BottomSheet>
  </section>
</template>
