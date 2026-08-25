<script setup lang="ts">
import { ACTIVE_POOL_CHIP, ACTIVE_POOL_LABELS, CONTAINER_TYPE_LABELS, EQUIPMENT_TYPE_LABELS, LOCATION_GLYPH, SHORT_HAUL_LABELS } from '#shared/utils/domain'

useHead({ title: 'Home' })

const { data, status, error, refresh } = await useFetch('/api/home')

const pendingSync = useState('pending-sync', () => 0)
watchEffect(() => {
  pendingSync.value = (data.value?.pendingSync.events ?? 0) + (data.value?.pendingSync.photos ?? 0)
})

/* --- Live on-duty elapsed clock --------------------------------- */
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

const duty = computed(() => data.value?.duty)

/**
 * An open tour ticks live from the authoritative Clock In timestamp; a closed
 * day shows the stored total and never keeps counting.
 */
const elapsed = computed(() => {
  const card = duty.value
  if (!card?.reportedForDutyAt) return '00:00:00'
  const start = new Date(card.reportedForDutyAt).getTime()
  const end = card.releasedFromDutyAt ? new Date(card.releasedFromDutyAt).getTime() : now.value
  return formatElapsedClock((end - start) / 1000)
})

const punching = ref(false)
const dutyError = ref('')

async function togglePunch() {
  if (punching.value) return
  punching.value = true
  dutyError.value = ''

  try {
    await $fetch(duty.value?.isOnDuty ? '/api/timecard/clock-out' : '/api/timecard/clock-in', { method: 'POST' })
    await refresh()
  }
  catch (err) {
    dutyError.value = apiErrorMessage(err, 'Could not record the punch.')
  }
  finally {
    punching.value = false
  }
}

const active = computed(() => data.value?.active)
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
      <!-- ── Duty status ─────────────────────────────────────── -->
      <div
        class="duty-card"
        :class="{ off: !duty?.isOnDuty }"
      >
        <div class="duty-head">
          <span class="eyebrow">Duty status</span>
          <StatusChip
            :variant="duty?.isOnDuty ? 'transit' : 'idle'"
            :label="duty?.isOnDuty ? 'On duty' : 'Off duty'"
          />
        </div>

        <div class="duty-body">
          <div
            class="duty-elapsed"
            role="timer"
            :aria-label="duty?.isOnDuty ? 'Time on duty today' : 'Total on duty today'"
          >
            {{ elapsed }}
          </div>
          <p class="duty-sub">
            {{ duty?.isOnDuty ? 'Elapsed since you reported for duty' : "Today's recorded on-duty time" }}
          </p>

          <div class="duty-facts">
            <div class="duty-fact">
              <small>Reported for duty</small>
              <b>{{ formatTime(duty?.reportedForDutyAt) }}</b>
            </div>
            <div class="duty-fact">
              <small>Released</small>
              <b>{{ duty?.releasedFromDutyAt ? formatTime(duty.releasedFromDutyAt) : 'In progress' }}</b>
            </div>
          </div>

          <p
            v-if="duty?.shortHaulStatus === 'NOT_AVAILABLE' || duty?.shortHaulStatus === 'AT_RISK'"
            class="banner"
            :class="duty.shortHaulStatus === 'NOT_AVAILABLE' ? 'err' : 'warn'"
            role="alert"
          >
            <span aria-hidden="true">!</span>
            <span>{{ SHORT_HAUL_LABELS[duty.shortHaulStatus] }}</span>
          </p>

          <p
            v-if="dutyError"
            class="banner err"
            role="alert"
          >
            <span aria-hidden="true">✕</span>
            <span>{{ dutyError }}</span>
          </p>

          <button
            class="btn-primary-action"
            :disabled="punching"
            @click="togglePunch"
          >
            {{ punching ? 'Recording…' : duty?.isOnDuty ? 'Clock Out' : 'Clock In' }}
          </button>
        </div>
      </div>

      <!-- ── Active movement ─────────────────────────────────── -->
      <template v-if="active">
        <div class="section-label">
          <span>Active movement</span>
          <NuxtLink :to="`/trips/${active.trip.id}`">Trip details</NuxtLink>
        </div>

        <div class="trip-card">
          <div class="trip-card-head">
            <div class="trip-card-meta">
              <span class="trip-flag line">
                {{ active.container ? CONTAINER_TYPE_LABELS[active.container.containerType] : active.trip.reference }}
              </span>
              <span
                class="trip-flag"
                :class="active.trip.isLoaded ? 'loaded' : 'empty'"
              >
                {{ active.trip.isLoaded ? 'Loaded' : 'Empty' }}
              </span>
            </div>

            <div class="trip-cno">
              {{ active.container?.number ?? '—' }}
            </div>

            <div class="trip-facts">
              <div class="trip-fact">
                <small>Equipment</small>
                <b>{{ active.container ? EQUIPMENT_TYPE_LABELS[active.container.equipmentType] : '—' }}</b>
              </div>
              <div class="trip-fact">
                <small>Chassis</small>
                <b>{{ active.chassis?.number ?? 'None' }}</b>
              </div>
              <div class="trip-fact">
                <small>Seal</small>
                <b>{{ active.trip.sealNumber ?? '—' }}</b>
              </div>
            </div>
          </div>

          <div class="route-strip">
            <div class="route-point">
              <small>Origin</small>
              <strong>{{ active.origin?.name ?? 'Not set' }}</strong>
            </div>
            <div
              class="route-arrow"
              aria-hidden="true"
            >
              →
            </div>
            <div class="route-point dest">
              <small>Drop-off</small>
              <strong>{{ active.destination?.name ?? 'Choose at drop-off' }}</strong>
            </div>
          </div>
        </div>

        <NuxtLink
          :to="active.primaryAction.to"
          class="btn-primary-action mb-4"
        >
          {{ active.primaryAction.label }}
        </NuxtLink>
      </template>

      <!-- ── No active movement ──────────────────────────────── -->
      <template v-else>
        <div class="section-label">
          <span>Start work</span>
        </div>

        <NuxtLink
          to="/pickups/new"
          class="btn-primary-action mb-3"
        >
          New Pickup
        </NuxtLink>
      </template>

      <div class="home-actions">
        <NuxtLink to="/scan">
          <span
            class="act-ico"
            aria-hidden="true"
          >⊙</span>
          Quick Scan
        </NuxtLink>
        <NuxtLink to="/containers">
          <span
            class="act-ico"
            aria-hidden="true"
          >▦</span>
          Containers
        </NuxtLink>
        <NuxtLink to="/locations">
          <span
            class="act-ico"
            aria-hidden="true"
          >◫</span>
          Locations
        </NuxtLink>
        <NuxtLink to="/timecard">
          <span
            class="act-ico"
            aria-hidden="true"
          >◷</span>
          Timecard
        </NuxtLink>
      </div>

      <!-- ── Recently handled ────────────────────────────────── -->
      <div class="section-label">
        <span>Recent containers</span>
        <NuxtLink to="/containers">View all</NuxtLink>
      </div>

      <div
        v-if="data.recentContainers.length"
        class="card rowlist"
      >
        <NuxtLink
          v-for="item in data.recentContainers"
          :key="item.id"
          :to="`/containers/${item.id}`"
          class="row"
        >
          <span
            class="row-ico"
            aria-hidden="true"
          >▦</span>
          <span class="row-main">
            <b class="mono">{{ item.number }}</b>
            <small>{{ item.locationName ?? 'In transit' }} · {{ formatRelative(item.lastActivityAt) }}</small>
          </span>
          <span class="row-end">
            <StatusChip
              :variant="ACTIVE_POOL_CHIP[item.activePoolState]"
              :label="ACTIVE_POOL_LABELS[item.activePoolState]"
            />
          </span>
        </NuxtLink>
      </div>

      <EmptyState
        v-else
        title="No active containers"
        description="Containers appear here once you start a pickup."
      />

      <div class="section-label">
        <span>Recent locations</span>
        <NuxtLink to="/locations">View all</NuxtLink>
      </div>

      <div
        v-if="data.recentLocations.length"
        class="card rowlist"
      >
        <NuxtLink
          v-for="item in data.recentLocations"
          :key="item.id"
          :to="`/containers?locationId=${item.id}`"
          class="row"
        >
          <span
            class="row-ico"
            aria-hidden="true"
          >{{ LOCATION_GLYPH[item.type] }}</span>
          <span class="row-main">
            <b>{{ item.name }}</b>
            <small>{{ item.city ?? '—' }}</small>
          </span>
          <span
            class="row-end"
            aria-hidden="true"
          >›</span>
        </NuxtLink>
      </div>

      <EmptyState
        v-else
        glyph="◫"
        title="No locations yet"
        description="Create the yards, terminals and customers you work with."
      >
        <NuxtLink
          to="/locations/new"
          class="btn-ghost"
        >
          Add a location
        </NuxtLink>
      </EmptyState>
    </template>
  </section>
</template>
