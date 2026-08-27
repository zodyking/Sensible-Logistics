<script setup lang="ts">
useHead({ title: 'Timecard' })

const { user } = useUserSession()
const { data, status, error, refresh } = await useFetch('/api/timecard')

const punching = ref(false)
const punchError = ref('')
const sheet = ref<'add' | 'audit' | null>(null)
const showPdf = ref(false)

const today = computed(() => data.value?.today)
const isOnDuty = computed(() => Boolean(today.value?.isOnDuty))

async function punch(direction: 'in' | 'out') {
  if (punching.value) return
  punching.value = true
  punchError.value = ''
  try {
    await $fetch(`/api/timecard/clock-${direction}`, { method: 'POST' })
    await refresh()
  }
  catch (err) {
    punchError.value = apiErrorMessage(err, 'Could not record the punch.')
  }
  finally {
    punching.value = false
  }
}

const mast = computed(() => {
  const company = data.value?.legalName || data.value?.companyName || ''
  const usdot = data.value?.usdotNumber ? `USDOT ${data.value.usdotNumber}` : null
  return [company, usdot].filter(Boolean).join(' · ')
})

const driverLine = computed(() => {
  const unit = data.value?.unitNumber
  const code = data.value?.driverCode
  const name = data.value?.driverName ?? user.value?.fullName ?? ''
  const extra = unit || code
  return extra ? `${name} · ${extra}` : name
})
</script>

<template>
  <section class="d-page">
    <div
      v-if="status === 'pending'"
      class="card p-6 text-center text-sm text-[var(--color-ink-500)]"
      role="status"
    >
      Loading your time record…
    </div>

    <p
      v-else-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ apiErrorMessage(error) }}</span>
    </p>

    <template v-else-if="data">
      <p
        v-if="punchError"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ punchError }}</span>
      </p>

      <div class="tc-paper">
        <div class="tc-mast">
          <div class="co">
            {{ mast }}
          </div>
          <div class="doc">
            Driver Time Card
            <span
              class="chip"
              :class="isOnDuty ? 'transit' : 'idle'"
            >{{ isOnDuty ? 'On Duty' : 'Off Duty' }}</span>
          </div>
        </div>

        <div class="tc-facts">
          <div>
            <small>Driver / unit</small>
            <b>{{ driverLine }}</b>
          </div>
          <div>
            <small>Week of</small>
            <b>{{ data.weekOf }}</b>
          </div>
          <div>
            <small>Reporting location</small>
            <b>{{ data.reportingLocationName ?? 'Not set' }}</b>
          </div>
          <div>
            <small>Exemption</small>
            <b>150 air-mile · §395.1(e)(1)</b>
          </div>
        </div>

        <div class="tc-bar">
          <button
            type="button"
            @click="sheet = 'add'"
          >
            + Entry
          </button>
          <button
            type="button"
            class="tc-pdf-btn"
            @click="showPdf = true"
          >
            PDF
          </button>
          <button
            type="button"
            class="tc-in"
            :disabled="punching || isOnDuty"
            @click="punch('in')"
          >
            In
          </button>
          <button
            type="button"
            class="tc-out"
            :disabled="punching || !isOnDuty"
            @click="punch('out')"
          >
            Out
          </button>
        </div>

        <div
          class="tc-cols"
          aria-hidden="true"
        >
          <span>Arrived</span>
          <span>Left</span>
          <span>Location / annotation</span>
        </div>

        <div
          v-for="day in data.weekDays"
          :key="day.workDate"
          class="tc-day"
          :class="{ off: day.isOff }"
        >
          <div class="tc-day-h">
            {{ formatLedgerDay(day.workDate) }}
            <b>{{ day.isOff ? 'Off' : formatHours(day.onDutyMinutes) }}</b>
          </div>

          <div
            v-if="day.isOff"
            class="tc-offline"
          >
            No punches — 10-hour rest
          </div>

          <button
            v-for="(punchRow, index) in day.punches"
            :key="index"
            type="button"
            class="tc-punch"
            :class="{ open: punchRow.open }"
            @click="sheet = 'audit'"
          >
            <span class="arr">{{ formatTime(punchRow.arrivedAt) }}</span>
            <span :class="punchRow.open ? 'open-t' : 'left'">
              {{ punchRow.open ? '—' : formatTime(punchRow.leftAt) }}
            </span>
            <span class="tc-place">
              <b class="tc-loc">{{ punchRow.location }}</b>
              <small class="tc-note">{{ punchRow.note }}</small>
            </span>
          </button>
        </div>

        <div class="tc-sum">
          <small>7-day on-duty</small>
          <b>{{ formatHours(data.weekOnDutyMinutes) }}</b>
        </div>
        <p class="tc-cert">
          I certify these time records are true and correct. I operated within 150 air-miles of the reporting location and returned there within 14 hours except as noted.
          Signature: /s/ {{ data.driverName }}
        </p>
      </div>
    </template>

    <BottomSheet
      :open="sheet === 'add'"
      title="Add punch"
      @close="sheet = null"
    >
      <p class="text-sm text-[var(--color-ink-500)]">
        Manual punches are corrections. That flow is next — Clock In / Clock Out on the bar records duty for this day.
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
      :open="sheet === 'audit'"
      title="Audit punch"
      @close="sheet = null"
    >
      <p class="text-sm text-[var(--color-ink-500)]">
        Corrections preserve the original value, who changed it, when, and why. Editing a punch from here is next.
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

    <Teleport to="body">
      <div
        v-if="showPdf && data"
        class="tc-pdf-overlay"
        @click.self="showPdf = false"
      >
        <button
          type="button"
          class="pdf-close"
          @click="showPdf = false"
        >
          Close PDF
        </button>
        <article class="tc-pdf">
          <div class="pdf-co">
            {{ mast }}
          </div>
          <h2>Driver Time Card</h2>
          <div class="pdf-sub">
            49 CFR § 395.1(e)(1) · 150 air-mile short-haul · Produce on request
          </div>
          <div class="pdf-meta">
            <div><b>Driver:</b> {{ driverLine }}</div>
            <div><b>Period:</b> {{ data.weekOf }}</div>
            <div><b>Reporting location:</b> {{ data.reportingLocationName ?? '—' }}</div>
            <div><b>Week on-duty:</b> {{ formatHours(data.weekOnDutyMinutes) }}</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Arrived</th>
                <th>Left</th>
                <th>Location</th>
                <th>Annotation</th>
              </tr>
            </thead>
            <tbody>
              <template
                v-for="day in data.weekDays"
                :key="day.workDate"
              >
                <tr class="dayh">
                  <td colspan="4">
                    {{ formatDayHeading(day.workDate) }}
                    <template v-if="day.isOff">
                      — Off duty
                    </template>
                  </td>
                </tr>
                <tr
                  v-for="(punchRow, index) in day.punches"
                  :key="index"
                >
                  <td>{{ formatTime(punchRow.arrivedAt) }}</td>
                  <td>{{ punchRow.open ? 'Open' : formatTime(punchRow.leftAt) }}</td>
                  <td>{{ punchRow.location }}</td>
                  <td>{{ punchRow.note }}</td>
                </tr>
              </template>
            </tbody>
          </table>
          <p>
            I certify these punches are true and correct. I stayed within 150 air-miles of the reporting location and returned there within 14 hours except as noted.
          </p>
          <p>
            <b>Signature:</b> /s/ {{ data.driverName }}
          </p>
        </article>
      </div>
    </Teleport>
  </section>
</template>
