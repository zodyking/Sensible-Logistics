<script setup lang="ts">
import {
  isTimeCardWorkDate,
  newManualTimeCardStop,
  TIME_CARD_STOP_MAX,
  timeCardPdfFileName,
  type TimeCardHeader,
  type TimeCardStop,
} from '#shared/utils/time-card'
import { toLocalIsoDate } from '#shared/utils/trip-days'
import { downloadBlobFile, openBlobInNewTab } from '~/utils/download-text'

const route = useRoute()
const workDate = computed(() => {
  const raw = String(route.params.date || '')
  return isTimeCardWorkDate(raw) ? raw : (toLocalIsoDate(new Date()) ?? '')
})

useHead({ title: 'Time card' })

if (!isTimeCardWorkDate(String(route.params.date || ''))) {
  await navigateTo(`/pickups/time-card/${toLocalIsoDate(new Date())}`, { replace: true })
}

const { data, status, error, refresh } = await useFetch(
  () => `/api/time-cards/${workDate.value}`,
  { watch: [workDate] },
)

const header = ref<TimeCardHeader | null>(null)
const stops = ref<TimeCardStop[]>([])
const saving = ref(false)
const saveError = ref('')
const savedFlash = ref('')
const pdfError = ref('')
const pdfBusy = ref<'view' | 'download' | ''>('')

watch(() => data.value?.card, (card) => {
  if (!card || saving.value) return
  header.value = { ...card.header }
  stops.value = card.stops.map(stop => ({ ...stop }))
}, { immediate: true })

const stopCount = computed(() => stops.value.length)
const canAddStop = computed(() => stopCount.value < TIME_CARD_STOP_MAX)

function stopSourceLabel(source: TimeCardStop['source']) {
  if (source === 'TRIP') return 'Trip'
  if (source === 'GPS') return 'GPS'
  return 'Manual'
}

function addStop() {
  if (!canAddStop.value) return
  stops.value = [...stops.value, newManualTimeCardStop()]
}

function removeStop(key: string) {
  stops.value = stops.value.filter(stop => stop.key !== key)
}

async function save() {
  if (!header.value || saving.value) return
  saving.value = true
  saveError.value = ''
  savedFlash.value = ''
  try {
    const result = await $fetch(`/api/time-cards/${workDate.value}`, {
      method: 'PATCH',
      body: {
        header: header.value,
        stops: stops.value,
      },
    })
    header.value = { ...result.card.header }
    stops.value = result.card.stops.map(stop => ({ ...stop }))
    savedFlash.value = 'Saved.'
    await refresh()
  }
  catch (err) {
    saveError.value = apiErrorMessage(err, 'Could not save the time card.')
  }
  finally {
    saving.value = false
  }
}

async function openPdf(download = false) {
  if (pdfBusy.value) return
  pdfBusy.value = download ? 'download' : 'view'
  pdfError.value = ''
  try {
    const blob = await $fetch<Blob>(`/api/time-cards/${workDate.value}/pdf`, {
      responseType: 'blob',
    })
    const fileName = timeCardPdfFileName(workDate.value)
    if (download) downloadBlobFile(blob, fileName)
    else openBlobInNewTab(blob, fileName)
  }
  catch (err) {
    pdfError.value = apiErrorMessage(err, 'Could not open the time card PDF.')
  }
  finally {
    pdfBusy.value = ''
  }
}
</script>

<template>
  <section class="d-page">
    <PageHeader
      eyebrow="My Trips"
      title="Daily time card"
      back-to="/pickups"
      back-label="Trips"
    />

    <div
      v-if="status === 'pending' && !header"
      class="card p-6 text-center text-sm text-[var(--color-ink-500)]"
      role="status"
    >
      Loading time card…
    </div>

    <p
      v-else-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ apiErrorMessage(error) }}</span>
    </p>

    <template v-else-if="header">
      <span class="wiz-label">Printed card</span>
      <div class="wiz-group">
        <div class="wiz-row">
          <span class="wiz-row-label">Date</span>
          <span>{{ formatWorkDate(workDate) }}</span>
        </div>
        <div class="wiz-row">
          <span class="wiz-row-label">Stops</span>
          <span>{{ stopCount }}/{{ TIME_CARD_STOP_MAX }}</span>
        </div>
      </div>
      <p class="wiz-hint">
        One FMCSA short-haul card per day. Stops fill from trips and GPS; change anything that looks wrong.
      </p>

      <span class="wiz-label">PDF</span>
      <div class="wiz-group">
        <button
          type="button"
          class="wiz-pick"
          :disabled="Boolean(pdfBusy)"
          @click="openPdf(false)"
        >
          <span class="wiz-pick-main">
            <b>{{ pdfBusy === 'view' ? 'Opening…' : 'View PDF' }}</b>
            <small>Open the two-page printed card</small>
          </span>
          <span
            class="wiz-chev"
            aria-hidden="true"
          >›</span>
        </button>
        <button
          type="button"
          class="wiz-pick"
          :disabled="Boolean(pdfBusy)"
          @click="openPdf(true)"
        >
          <span class="wiz-pick-main">
            <b>{{ pdfBusy === 'download' ? 'Downloading…' : 'Download' }}</b>
            <small>Save the PDF to this phone</small>
          </span>
          <span
            class="wiz-chev"
            aria-hidden="true"
          >›</span>
        </button>
      </div>
      <p
        v-if="pdfError"
        class="banner err mt-3"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ pdfError }}</span>
      </p>

      <p
        v-if="saveError"
        class="banner err mt-3"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ saveError }}</span>
      </p>
      <p
        v-else-if="savedFlash"
        class="banner ok mt-3"
        role="status"
      >
        <span>{{ savedFlash }}</span>
      </p>

      <div class="wiz-gap" />

      <form @submit.prevent="save">
        <span class="wiz-label">Driver</span>
        <div class="wiz-group">
          <div class="wiz-row">
            <label
              class="wiz-row-label"
              for="tc-driver-name"
            >Name</label>
            <input
              id="tc-driver-name"
              v-model="header.driverName"
              class="input"
              autocomplete="name"
            >
          </div>
          <div class="wiz-row">
            <label
              class="wiz-row-label"
              for="tc-employee-id"
            >Emp ID</label>
            <input
              id="tc-employee-id"
              v-model="header.employeeId"
              class="input"
            >
          </div>
          <div class="wiz-row">
            <label
              class="wiz-row-label"
              for="tc-truck-vin"
            >VIN</label>
            <input
              id="tc-truck-vin"
              v-model="header.truckUnit"
              class="input mono"
            >
          </div>
          <div class="wiz-row">
            <label
              class="wiz-row-label"
              for="tc-trailer"
            >Trailer</label>
            <input
              id="tc-trailer"
              v-model="header.trailerNumber"
              class="input"
            >
          </div>
          <div class="wiz-row">
            <label
              class="wiz-row-label"
              for="tc-cdl"
            >CDL</label>
            <input
              id="tc-cdl"
              v-model="header.cdl"
              class="input"
              placeholder="Add in Settings"
            >
          </div>
          <div class="wiz-row">
            <label
              class="wiz-row-label"
              for="tc-dispatcher"
            >Dispatch</label>
            <input
              id="tc-dispatcher"
              v-model="header.dispatcher"
              class="input"
            >
          </div>
        </div>
        <p class="wiz-hint">
          Change the VIN if you ran a different truck today. Trailer lists every chassis; long lists shorten with … on the PDF.
        </p>

        <span class="wiz-label">Trip</span>
        <div class="wiz-group">
          <div class="wiz-row">
            <label
              class="wiz-row-label"
              for="tc-route"
            >Route</label>
            <input
              id="tc-route"
              v-model="header.routeCustomer"
              class="input"
            >
          </div>
          <div class="wiz-row">
            <label
              class="wiz-row-label"
              for="tc-odo-start"
            >Start mi</label>
            <input
              id="tc-odo-start"
              v-model="header.startOdometer"
              class="input"
              inputmode="numeric"
            >
          </div>
          <div class="wiz-row">
            <label
              class="wiz-row-label"
              for="tc-odo-end"
            >End mi</label>
            <input
              id="tc-odo-end"
              v-model="header.endOdometer"
              class="input"
              inputmode="numeric"
            >
          </div>
        </div>

        <span class="wiz-label">Stops</span>
        <div
          v-if="stops.length"
          class="audit-eq-list"
        >
          <article
            v-for="(stop, index) in stops"
            :key="stop.key"
            class="wiz-group"
          >
            <header class="audit-eq-nav">
              <span class="audit-eq-back-spacer" />
              <b class="audit-eq-title">{{ String(index + 1).padStart(2, '0') }} · {{ stopSourceLabel(stop.source) }}</b>
              <button
                v-if="stop.source === 'MANUAL'"
                type="button"
                class="audit-eq-remove"
                @click="removeStop(stop.key)"
              >
                Remove
              </button>
              <span
                v-else
                class="audit-eq-back-spacer"
              />
            </header>
            <div class="wiz-row">
              <label
                class="wiz-row-label"
                :for="`tc-in-${stop.key}`"
              >In</label>
              <input
                :id="`tc-in-${stop.key}`"
                v-model="stop.timeIn"
                class="input mono"
                inputmode="numeric"
                placeholder="07:00"
              >
            </div>
            <div class="wiz-row">
              <label
                class="wiz-row-label"
                :for="`tc-out-${stop.key}`"
              >Out</label>
              <input
                :id="`tc-out-${stop.key}`"
                v-model="stop.timeOut"
                class="input mono"
                inputmode="numeric"
                placeholder="07:20"
              >
            </div>
            <div class="wiz-row">
              <label
                class="wiz-row-label"
                :for="`tc-loc-${stop.key}`"
              >Place</label>
              <input
                :id="`tc-loc-${stop.key}`"
                v-model="stop.location"
                class="input"
              >
            </div>
            <div class="wiz-row">
              <label
                class="wiz-row-label"
                :for="`tc-act-${stop.key}`"
              >Work</label>
              <input
                :id="`tc-act-${stop.key}`"
                v-model="stop.activity"
                class="input"
              >
            </div>
          </article>
        </div>
        <EmptyState
          v-else
          glyph="◷"
          title="No stops yet"
          description="Trips and GPS fill this list as you work."
        />

        <button
          type="button"
          class="audit-eq-new"
          :disabled="!canAddStop"
          @click="addStop"
        >
          + Add stop
        </button>

        <div class="wiz-actions">
          <button
            type="submit"
            class="wiz-next"
            :disabled="saving"
          >
            {{ saving ? 'Saving…' : 'Save time card' }}
          </button>
        </div>
      </form>
    </template>
  </section>
</template>
