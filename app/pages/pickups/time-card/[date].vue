<script setup lang="ts">
import {
  isTimeCardWorkDate,
  newManualTimeCardStop,
  TIME_CARD_STOP_MAX,
  type TimeCardHeader,
  type TimeCardStop,
} from '#shared/utils/time-card'
import { toLocalIsoDate } from '#shared/utils/trip-days'

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

watch(() => data.value?.card, (card) => {
  if (!card || saving.value) return
  header.value = { ...card.header }
  stops.value = card.stops.map(stop => ({ ...stop }))
}, { immediate: true })

const stopCount = computed(() => stops.value.length)
const canAddStop = computed(() => stopCount.value < TIME_CARD_STOP_MAX)

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

function openPdf(download = false) {
  const suffix = download ? '?download=1' : ''
  window.open(`/api/time-cards/${workDate.value}/pdf${suffix}`, '_blank', 'noopener')
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

    <p class="field-hint mb-3">
      One printed FMCSA short-haul card per day. Stops fill from your trips and GPS as you work; change anything that looks wrong.
    </p>

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
      <div class="tc-paper">
        <div class="tc-mast">
          <div class="co">
            Sensible Logistics · 49 CFR §395.1(e)(1)
          </div>
          <div class="doc">
            <span>Short-haul time card</span>
            <StatusChip
              :variant="data?.card.status === 'COMPLETED' ? 'ok' : 'idle'"
              :label="data?.card.status === 'COMPLETED' ? 'Signed' : 'Open'"
            />
          </div>
        </div>

        <div class="tc-facts">
          <div>
            <small>Work date</small>
            <b>{{ formatWorkDate(workDate) }}</b>
          </div>
          <div>
            <small>On duty</small>
            <b>{{ header.totalOnDutyHours || '—' }}</b>
          </div>
          <div>
            <small>Report</small>
            <b class="mono">{{ header.reportForDuty || '—' }}</b>
          </div>
          <div>
            <small>Released</small>
            <b class="mono">{{ header.releasedFromDuty || '—' }}</b>
          </div>
        </div>

        <div class="tc-bar tc-bar-actions">
          <button
            type="button"
            class="tc-pdf-btn"
            @click="openPdf(false)"
          >
            View PDF
          </button>
          <button
            type="button"
            @click="openPdf(true)"
          >
            Download
          </button>
        </div>
      </div>

      <p
        v-if="saveError"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ saveError }}</span>
      </p>
      <p
        v-else-if="savedFlash"
        class="banner ok"
        role="status"
      >
        <span>{{ savedFlash }}</span>
      </p>

      <form
        class="tc-form card p-4"
        @submit.prevent="save"
      >
        <div class="settings-name-grid">
          <label class="field">
            <span>Driver name</span>
            <input
              v-model="header.driverName"
              class="input"
              autocomplete="name"
            >
          </label>
          <label class="field">
            <span>Employee ID</span>
            <input
              v-model="header.employeeId"
              class="input"
            >
          </label>
          <label class="field">
            <span>Truck / unit #</span>
            <input
              v-model="header.truckUnit"
              class="input"
            >
          </label>
          <label class="field">
            <span>Trailer #</span>
            <input
              v-model="header.trailerNumber"
              class="input"
            >
          </label>
          <label class="field">
            <span>CDL # / state</span>
            <input
              v-model="header.cdl"
              class="input"
            >
          </label>
          <label class="field">
            <span>Dispatcher</span>
            <input
              v-model="header.dispatcher"
              class="input"
            >
          </label>
          <label class="field">
            <span>Start odometer</span>
            <input
              v-model="header.startOdometer"
              class="input"
              inputmode="numeric"
            >
          </label>
          <label class="field">
            <span>End odometer</span>
            <input
              v-model="header.endOdometer"
              class="input"
              inputmode="numeric"
            >
          </label>
        </div>

        <label class="field">
          <span>Route / customer</span>
          <input
            v-model="header.routeCustomer"
            class="input"
          >
        </label>

        <div class="section-label">
          <span>Stops</span>
          <span>{{ stopCount }}/{{ TIME_CARD_STOP_MAX }}</span>
        </div>

        <article
          v-for="(stop, index) in stops"
          :key="stop.key"
          class="tc-stop-card"
        >
          <div class="tc-stop-head">
            <b>{{ String(index + 1).padStart(2, '0') }}</b>
            <small>{{ stop.source === 'TRIP' ? 'Trip' : stop.source === 'GPS' ? 'GPS' : 'Manual' }}</small>
            <button
              v-if="stop.source === 'MANUAL'"
              type="button"
              class="tc-stop-remove"
              @click="removeStop(stop.key)"
            >
              Remove
            </button>
          </div>
          <div class="settings-name-grid">
            <label class="field">
              <span>Time in</span>
              <input
                v-model="stop.timeIn"
                class="input mono"
                inputmode="numeric"
                placeholder="07:00"
              >
            </label>
            <label class="field">
              <span>Time out</span>
              <input
                v-model="stop.timeOut"
                class="input mono"
                inputmode="numeric"
                placeholder="07:20"
              >
            </label>
          </div>
          <label class="field">
            <span>Location / stop</span>
            <input
              v-model="stop.location"
              class="input"
            >
          </label>
          <label class="field">
            <span>Activity / remarks</span>
            <input
              v-model="stop.activity"
              class="input"
            >
          </label>
        </article>

        <button
          type="button"
          class="btn-ghost w-full mb-4"
          :disabled="!canAddStop"
          @click="addStop"
        >
          Add stop
        </button>

        <label class="field">
          <span>Preceding 7 days on-duty hours</span>
          <input
            v-model="header.preceding7DayHours"
            class="input"
            inputmode="decimal"
          >
        </label>

        <div class="settings-name-grid">
          <label class="field">
            <span>Driver signature</span>
            <input
              v-model="header.signedName"
              class="input"
              autocomplete="name"
            >
          </label>
          <label class="field">
            <span>Signature date</span>
            <input
              v-model="header.signedDate"
              class="input"
              placeholder="10/28/2026"
            >
          </label>
        </div>

        <button
          type="submit"
          class="btn-primary-action"
          :disabled="saving"
        >
          {{ saving ? 'Saving…' : 'Save time card' }}
        </button>
      </form>
    </template>
  </section>
</template>
