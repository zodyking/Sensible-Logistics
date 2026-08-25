<script setup lang="ts">
import { SHORT_HAUL_LABELS } from '#shared/utils/domain'

useHead({ title: 'Timecard' })

const { data, status, error, refresh } = await useFetch('/api/timecard')

const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  ticker = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
})

const today = computed(() => data.value?.today)

const elapsed = computed(() => {
  const card = today.value
  if (!card?.reportedForDutyAt) return '00:00:00'
  // Once released, show the server's authoritative total, which nets out breaks.
  if (!card.isOnDuty) return formatElapsedClock(card.onDutyMinutes * 60)
  return formatElapsedClock((now.value - new Date(card.reportedForDutyAt).getTime()) / 1000)
})

const punching = ref(false)
const punchError = ref('')

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

const cyclePercent = computed(() => {
  const cycle = data.value?.cycle
  if (!cycle?.limitMinutes) return 0
  return Math.min(100, Math.round((cycle.minutes / cycle.limitMinutes) * 100))
})

const todayDate = computed(() => today.value?.workDate ?? new Date().toISOString().slice(0, 10))
</script>

<template>
  <section class="d-page">
    <PageHeader
      eyebrow="49 CFR §395.1(e)(1)"
      title="Short-haul time record"
    />

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
      <!-- ── Short-haul status banner ─────────────────────────── -->
      <p
        v-if="today?.shortHaulStatus === 'NOT_AVAILABLE'"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">!</span>
        <span>
          <b>{{ SHORT_HAUL_LABELS.NOT_AVAILABLE }}</b>
          The timecard alone is not sufficient HOS documentation for this day.
        </span>
      </p>
      <p
        v-else-if="today?.shortHaulStatus === 'AT_RISK'"
        class="banner warn"
        role="alert"
      >
        <span aria-hidden="true">!</span>
        <span>
          <b>Approaching the 14-hour limit</b>
          You must be released from duty within 14 consecutive hours of reporting.
        </span>
      </p>
      <p
        v-else
        class="banner info"
      >
        <span aria-hidden="true">▸</span>
        <span>
          <b>Time record — not an ELD</b>
          This is a §395.1(e)(1) short-haul time record, not a RODS graph-grid log.
        </span>
      </p>

      <!-- ── Duty card ───────────────────────────────────────── -->
      <div
        class="duty-card"
        :class="{ off: !today?.isOnDuty }"
      >
        <div class="duty-head">
          <span class="eyebrow">{{ formatWorkDate(todayDate) }}</span>
          <StatusChip
            :variant="today?.isOnDuty ? 'transit' : 'idle'"
            :label="today?.isOnDuty ? 'On duty' : 'Off duty'"
          />
        </div>

        <div class="duty-body">
          <div
            class="duty-elapsed"
            role="timer"
          >
            {{ elapsed }}
          </div>
          <p class="duty-sub">
            {{ today?.isOnDuty ? 'Current elapsed on-duty' : "Total on-duty hours for the day" }}
          </p>

          <div class="duty-facts">
            <div class="duty-fact">
              <small>Reported for duty</small>
              <b>{{ formatTime(today?.reportedForDutyAt) }}</b>
            </div>
            <div class="duty-fact">
              <small>Released from duty</small>
              <b>{{ today?.releasedFromDutyAt ? formatTime(today.releasedFromDutyAt) : 'IN PROGRESS' }}</b>
            </div>
          </div>

          <p
            v-if="punchError"
            class="banner err"
            role="alert"
          >
            <span aria-hidden="true">✕</span>
            <span>{{ punchError }}</span>
          </p>

          <div class="grid grid-cols-2 gap-3">
            <button
              class="btn-dark !bg-white !text-[var(--color-navy-900)]"
              :disabled="punching || today?.isOnDuty"
              @click="punch('in')"
            >
              Clock In
            </button>
            <button
              class="btn-primary-action !min-h-12 !text-base"
              :disabled="punching || !today?.isOnDuty"
              @click="punch('out')"
            >
              Clock Out
            </button>
          </div>
        </div>
      </div>

      <NuxtLink
        :to="`/timecard/${todayDate}/record`"
        class="btn-primary-action mb-5"
      >
        Show DOT Timecard
      </NuxtLink>

      <!-- ── Required totals ─────────────────────────────────── -->
      <div class="card p-4">
        <span class="eyebrow">Required totals</span>

        <div class="mt-3 flex items-baseline justify-between border-b border-[var(--color-line-200)] pb-3">
          <div>
            <b class="block text-sm">Preceding 7 days on duty</b>
            <small class="text-xs text-[var(--color-ink-500)]">§395.8(j)(2) — required for intermittent drivers</small>
          </div>
          <b class="mono text-lg">{{ formatHours(data.preceding7DayMinutes) }}</b>
        </div>

        <div class="pt-3">
          <div class="mb-2 flex items-baseline justify-between">
            <div>
              <b class="block text-sm">Rolling cycle</b>
              <small class="text-xs text-[var(--color-ink-500)]">{{ data.cycle.label }}</small>
            </div>
            <b class="mono text-lg">{{ formatHours(data.cycle.minutes) }}</b>
          </div>

          <div
            class="h-2 overflow-hidden rounded-full bg-[var(--color-paper-100)]"
            role="progressbar"
            :aria-valuenow="cyclePercent"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="`Cycle hours used: ${cyclePercent} percent of ${data.cycle.label}`"
          >
            <span
              class="block h-full rounded-full"
              :class="cyclePercent >= 90 ? 'bg-[var(--color-err-600)]' : cyclePercent >= 75 ? 'bg-[var(--color-amber-500)]' : 'bg-[var(--color-blue-500)]'"
              :style="{ width: `${cyclePercent}%` }"
            />
          </div>
          <small class="mt-1 block text-xs text-[var(--color-ink-500)]">
            {{ cyclePercent }}% of {{ formatHours(data.cycle.limitMinutes) }}
          </small>
        </div>
      </div>

      <!-- ── History ─────────────────────────────────────────── -->
      <div class="section-label">
        <span>Recorded days</span>
      </div>

      <div
        v-if="data.history.length"
        class="card rowlist"
      >
        <NuxtLink
          v-for="card in data.history"
          :key="card.id"
          :to="`/timecard/${card.workDate}/record`"
          class="row"
        >
          <span
            class="row-ico"
            aria-hidden="true"
          >◷</span>
          <span class="row-main">
            <b>{{ formatWorkDate(card.workDate) }}</b>
            <small>
              {{ formatTime(card.reportedForDutyAt) }} –
              {{ card.releasedFromDutyAt ? formatTime(card.releasedFromDutyAt) : 'in progress' }}
            </small>
          </span>
          <span class="row-end flex flex-col items-end gap-1">
            <b class="mono text-sm text-[var(--color-ink-900)]">{{ formatHours(card.totalOnDutyMinutes) }}</b>
            <StatusChip
              v-if="card.shortHaulStatus === 'NOT_AVAILABLE'"
              variant="err"
              label="Not covered"
            />
          </span>
        </NuxtLink>
      </div>

      <EmptyState
        v-else
        glyph="◷"
        title="No recorded days yet"
        description="Clock in to start today's short-haul time record."
      />

      <p class="mt-6 text-xs text-[var(--color-ink-500)]">
        Time records are retained for at least six months and cannot be deleted inside that window.
        Corrections preserve the original value, who changed it, when, and why.
      </p>
    </template>
  </section>
</template>
