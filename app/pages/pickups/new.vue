<script setup lang="ts">
import { ACTIVE_POOL_LABELS, CONTAINER_TYPES, CONTAINER_TYPE_LABELS, EQUIPMENT_TYPES, EQUIPMENT_TYPE_LABELS, LOCATION_GLYPH } from '#shared/utils/domain'
import type { ContainerType, EquipmentType } from '#shared/utils/domain'
import { formatContainerNumber, normalizeContainerNumber, validateContainerNumber } from '#shared/utils/iso6346'

useHead({ title: 'New pickup' })

type Step = 'location' | 'container' | 'chassis' | 'details' | 'confirm'
const STEPS: Step[] = ['location', 'container', 'chassis', 'details', 'confirm']
const STEP_TITLES: Record<Step, string> = {
  location: 'Where are you picking up?',
  container: 'Which container?',
  chassis: 'Chassis',
  details: 'Load, seal and notes',
  confirm: 'Confirm pickup',
}

const step = ref<Step>('location')
const stepIndex = computed(() => STEPS.indexOf(step.value))

/* --- Data sources ----------------------------------------------- */
const locationSearch = ref('')
const { data: locationData } = await useFetch('/api/locations', {
  query: computed(() => ({ q: locationSearch.value || undefined, limit: 50 })),
})

const { data: chassisData } = await useFetch('/api/chassis', {
  query: { availableOnly: 'true', limit: 100 },
})

/* --- Form state -------------------------------------------------- */
const originLocationId = ref<string | null>(null)
const originLocation = computed(() =>
  locationData.value?.items.find(l => l.id === originLocationId.value) ?? null)

const route = useRoute()
const rawNumber = ref(String(route.query.number ?? ''))
const containerType = ref<ContainerType>('TROPICAL')
const equipmentType = ref<EquipmentType>('HC_40')
const chassisId = ref<string | null>(null)
const isLoaded = ref(true)
const sealNumber = ref('')
const notes = ref('')

watch(chassisData, (data) => {
  const wanted = normalizeContainerNumber(String(route.query.chassis ?? ''))
  if (!wanted || chassisId.value) return
  const match = data?.items.find(c => normalizeContainerNumber(c.number) === wanted)
  if (match) chassisId.value = match.id
}, { immediate: true })

const submitting = ref(false)
const errorMessage = ref('')

/* --- ISO 6346 validation (mirrors the server implementation) ----- */
const normalized = computed(() => normalizeContainerNumber(rawNumber.value))
const validation = computed(() => validateContainerNumber(rawNumber.value))
const showValidation = computed(() => normalized.value.length >= 11)

/* --- Active-pool resolution -------------------------------------- */
type Resolution = Awaited<ReturnType<typeof resolveNumber>>
const resolution = ref<Resolution | null>(null)
const resolving = ref(false)

function resolveNumber(number: string) {
  return $fetch('/api/containers/resolve', { query: { number } })
}

async function checkPool() {
  if (normalized.value.length < 11) return
  resolving.value = true
  errorMessage.value = ''
  try {
    resolution.value = await resolveNumber(normalized.value)
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not check the active pool.')
  }
  finally {
    resolving.value = false
  }
}

// Re-check whenever the driver edits the identifier.
watch(normalized, (value) => {
  resolution.value = null
  if (value.length === 11) checkPool()
})

const RESOLUTION_COPY: Record<string, { variant: 'ok' | 'warn' | 'err' | 'info', title: string }> = {
  REUSE_ACTIVE: { variant: 'info', title: 'Already in the active pool' },
  REACTIVATE: { variant: 'warn', title: 'Known container — will be reactivated' },
  CREATE: { variant: 'ok', title: 'New container record' },
  CONFLICT: { variant: 'err', title: 'Another driver holds this container' },
}

const blockedByConflict = computed(() => resolution.value?.outcome === 'CONFLICT')

/* --- The movement, created once the identifier is confirmed ------ */
const tripId = ref<string | null>(null)

const canAdvance = computed(() => {
  switch (step.value) {
    case 'location': return Boolean(originLocationId.value)
    case 'container': return normalized.value.length === 11 && !blockedByConflict.value && !resolving.value
    case 'chassis': return true
    case 'details': return true
    case 'confirm': return true
  }
  return false
})

async function next() {
  errorMessage.value = ''

  // Leaving the container step is the activation point: claim it now so other
  // drivers immediately see the container is being worked (spec 5.3).
  if (step.value === 'container' && !tripId.value) {
    await startPickup()
    if (errorMessage.value) return
  }

  const index = stepIndex.value
  if (index < STEPS.length - 1) step.value = STEPS[index + 1]!
}

function back() {
  const index = stepIndex.value
  if (index > 0) step.value = STEPS[index - 1]!
}

async function startPickup() {
  submitting.value = true
  try {
    const result = await $fetch('/api/pickups/start', {
      method: 'POST',
      body: {
        // Generated client-side and reused on retry, so a flaky connection
        // cannot create two movements.
        eventId: crypto.randomUUID(),
        containerNumber: normalized.value,
        containerType: containerType.value,
        equipmentType: equipmentType.value,
        originLocationId: originLocationId.value,
      },
    })
    tripId.value = result.trip.id
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not start the pickup.')
  }
  finally {
    submitting.value = false
  }
}

async function confirm() {
  if (!tripId.value || submitting.value) return
  submitting.value = true
  errorMessage.value = ''

  try {
    await $fetch(`/api/trips/${tripId.value}/confirm`, {
      method: 'POST',
      body: {
        eventId: crypto.randomUUID(),
        chassisId: chassisId.value,
        isLoaded: isLoaded.value,
        sealNumber: sealNumber.value || null,
        notes: notes.value || null,
      },
    })
    await navigateTo(`/trips/${tripId.value}`)
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not confirm the pickup.')
  }
  finally {
    submitting.value = false
  }
}

async function abandon() {
  if (!tripId.value) {
    await navigateTo('/')
    return
  }

  try {
    await $fetch(`/api/trips/${tripId.value}/cancel`, {
      method: 'POST',
      body: { eventId: crypto.randomUUID(), reason: 'Driver cancelled before confirming.' },
    })
  }
  finally {
    await navigateTo('/')
  }
}

const selectedChassis = computed(() =>
  chassisData.value?.items.find(c => c.id === chassisId.value) ?? null)
</script>

<template>
  <section class="d-page">
    <PageHeader
      eyebrow="New pickup"
      :title="STEP_TITLES[step]"
      back-to="/"
      back-label="Home"
    />

    <div
      class="stepper"
      role="progressbar"
      :aria-valuenow="stepIndex + 1"
      aria-valuemin="1"
      :aria-valuemax="STEPS.length"
      :aria-label="`Step ${stepIndex + 1} of ${STEPS.length}`"
    >
      <span
        v-for="(name, index) in STEPS"
        :key="name"
        class="stepper-step"
        :class="{ done: index < stepIndex, on: index === stepIndex }"
      />
    </div>

    <p
      v-if="errorMessage"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ errorMessage }}</span>
    </p>

    <!-- ── Step 1 · Location ───────────────────────────────────── -->
    <template v-if="step === 'location'">
      <div class="searchbar">
        <span aria-hidden="true">⌕</span>
        <input
          v-model="locationSearch"
          type="search"
          placeholder="Search yards, terminals, customers…"
          aria-label="Search locations"
        >
      </div>

      <div
        v-if="locationData?.items.length"
        class="card rowlist"
      >
        <button
          v-for="location in locationData.items"
          :key="location.id"
          type="button"
          class="row"
          :aria-pressed="originLocationId === location.id"
          @click="originLocationId = location.id"
        >
          <span
            class="row-ico"
            aria-hidden="true"
          >{{ LOCATION_GLYPH[location.type] }}</span>
          <span class="row-main">
            <b>{{ location.name }}</b>
            <small>{{ [location.addressLine1, location.city].filter(Boolean).join(' · ') || '—' }}</small>
          </span>
          <span class="row-end">
            <StatusChip
              v-if="originLocationId === location.id"
              variant="ok"
              label="Selected"
            />
            <span
              v-else
              aria-hidden="true"
            >›</span>
          </span>
        </button>
      </div>

      <EmptyState
        v-else
        glyph="◫"
        title="No locations match"
        description="Create the yard, terminal or customer you are working from."
      >
        <NuxtLink
          to="/locations/new"
          class="btn-ghost"
        >
          Add a location
        </NuxtLink>
      </EmptyState>
    </template>

    <!-- ── Step 2 · Container ──────────────────────────────────── -->
    <template v-else-if="step === 'container'">
      <div class="card p-4">
        <label class="field">
          <span>Container number</span>
          <input
            v-model="rawNumber"
            class="input mono"
            :class="{ invalid: showValidation && !validation.structureValid }"
            placeholder="MSCU4521894"
            autocapitalize="characters"
            autocomplete="off"
            spellcheck="false"
            maxlength="15"
            aria-describedby="container-validation"
          >
          <small class="field-hint">Four letters, six digits and a check digit.</small>
        </label>

        <NuxtLink
          to="/scan"
          class="btn-ghost w-full"
        >
          <span aria-hidden="true">⊙</span> Scan with the camera instead
        </NuxtLink>

        <div
          id="container-validation"
          aria-live="polite"
        >
          <template v-if="showValidation">
            <p
              v-if="validation.valid"
              class="banner ok mt-3 mb-0"
            >
              <span aria-hidden="true">✓</span>
              <span>
                <b>{{ formatContainerNumber(normalized) }}</b>
                ISO 6346 check digit is valid.
              </span>
            </p>

            <p
              v-else
              class="banner warn mt-3 mb-0"
            >
              <span aria-hidden="true">!</span>
              <span>
                <b>Check the number</b>
                {{ validation.errors[0] }}
                <template v-if="validation.expectedCheckDigit !== null">
                  Expected check digit {{ validation.expectedCheckDigit }}.
                </template>
              </span>
            </p>

            <p
              v-for="warning in validation.warnings"
              :key="warning"
              class="banner info mt-2 mb-0"
            >
              <span aria-hidden="true">▸</span>
              <span>{{ warning }}</span>
            </p>
          </template>
        </div>
      </div>

      <!-- Active-pool resolution -->
      <div
        v-if="resolving"
        class="banner info mt-4"
        role="status"
      >
        <span aria-hidden="true">▸</span>
        <span>Checking the active container pool…</span>
      </div>

      <template v-else-if="resolution">
        <div
          class="banner mt-4"
          :class="RESOLUTION_COPY[resolution.outcome]?.variant"
          role="status"
        >
          <span aria-hidden="true">▸</span>
          <span>
            <b>{{ RESOLUTION_COPY[resolution.outcome]?.title }}</b>
            {{ resolution.message }}
          </span>
        </div>

        <!-- Conflict screen: show who has it, never create a duplicate -->
        <div
          v-if="resolution.outcome === 'CONFLICT' && resolution.holder"
          class="card p-4"
        >
          <span class="eyebrow">Current holder</span>
          <div class="trip-facts mt-3 !border-t-0 !pt-0">
            <div class="trip-fact">
              <small>Driver</small>
              <b>{{ resolution.holder.driverName }}</b>
            </div>
            <div class="trip-fact">
              <small>State</small>
              <b>{{ ACTIVE_POOL_LABELS[resolution.holder.activePoolState as keyof typeof ACTIVE_POOL_LABELS] }}</b>
            </div>
            <div class="trip-fact">
              <small>Believed at</small>
              <b>{{ resolution.holder.believedLocationName ?? 'In transit' }}</b>
            </div>
          </div>
          <p class="mt-4 text-sm text-[var(--color-ink-500)]">
            A second pickup cannot be started for this container. Contact dispatch or an administrator to
            resolve the conflict.
          </p>
        </div>

        <!-- Classification is required for a brand-new identity -->
        <div
          v-if="resolution.outcome === 'CREATE'"
          class="card mt-4 p-4"
        >
          <label class="field">
            <span>Container type</span>
            <select
              v-model="containerType"
              class="select"
            >
              <option
                v-for="type in CONTAINER_TYPES"
                :key="type"
                :value="type"
              >
                {{ CONTAINER_TYPE_LABELS[type] }}
              </option>
            </select>
          </label>

          <label class="field !mb-0">
            <span>Equipment size / type</span>
            <select
              v-model="equipmentType"
              class="select"
            >
              <option
                v-for="type in EQUIPMENT_TYPES"
                :key="type"
                :value="type"
              >
                {{ EQUIPMENT_TYPE_LABELS[type] }}
              </option>
            </select>
          </label>
        </div>
      </template>
    </template>

    <!-- ── Step 3 · Chassis ────────────────────────────────────── -->
    <template v-else-if="step === 'chassis'">
      <div class="card rowlist">
        <button
          type="button"
          class="row"
          :aria-pressed="chassisId === null"
          @click="chassisId = null"
        >
          <span
            class="row-ico"
            aria-hidden="true"
          >∅</span>
          <span class="row-main">
            <b>No chassis</b>
            <small>Grounded move or chassis assigned later</small>
          </span>
          <span class="row-end">
            <StatusChip
              v-if="chassisId === null"
              variant="ok"
              label="Selected"
            />
          </span>
        </button>

        <button
          v-for="item in chassisData?.items ?? []"
          :key="item.id"
          type="button"
          class="row"
          :aria-pressed="chassisId === item.id"
          @click="chassisId = item.id"
        >
          <span
            class="row-ico"
            aria-hidden="true"
          >⚭</span>
          <span class="row-main">
            <b class="mono">{{ item.number }}</b>
            <small>{{ [item.provider, item.sizeCompatibility].filter(Boolean).join(' · ') || '—' }}</small>
          </span>
          <span class="row-end">
            <StatusChip
              v-if="chassisId === item.id"
              variant="ok"
              label="Selected"
            />
          </span>
        </button>
      </div>

      <p class="mt-4 text-sm text-[var(--color-ink-500)]">
        Only available chassis are listed. Scan a plate from the Scan tab to jump here with it selected.
      </p>
    </template>

    <!-- ── Step 4 · Details ────────────────────────────────────── -->
    <template v-else-if="step === 'details'">
      <div class="card p-4">
        <fieldset class="field">
          <legend class="field-label">
            Load state
          </legend>
          <div class="grid grid-cols-2 gap-3">
            <button
              type="button"
              class="btn-ghost min-h-[52px]"
              :class="isLoaded ? '!border-[var(--color-ok-600)] !bg-[var(--color-ok-100)] !text-[var(--color-ok-600)]' : ''"
              :aria-pressed="isLoaded"
              @click="isLoaded = true"
            >
              Loaded
            </button>
            <button
              type="button"
              class="btn-ghost min-h-[52px]"
              :class="!isLoaded ? '!border-[var(--color-navy-800)] !bg-[var(--color-paper-100)] !text-[var(--color-navy-800)]' : ''"
              :aria-pressed="!isLoaded"
              @click="isLoaded = false"
            >
              Empty
            </button>
          </div>
        </fieldset>

        <label class="field">
          <span>Seal number</span>
          <input
            v-model="sealNumber"
            class="input mono"
            placeholder="004512"
            autocapitalize="characters"
            autocomplete="off"
          >
          <small class="field-hint">Leave blank if the container is empty or unsealed.</small>
        </label>

        <label class="field !mb-0">
          <span>Notes</span>
          <textarea
            v-model="notes"
            class="textarea"
            placeholder="Damage, exceptions, gate instructions…"
          />
        </label>
      </div>

      <p class="banner info mt-4">
        <span aria-hidden="true">▸</span>
        <span>Interchange/EIR capture and damage photos attach to this event once object storage is deployed.</span>
      </p>
    </template>

    <!-- ── Step 5 · Confirm ────────────────────────────────────── -->
    <template v-else>
      <div class="trip-card">
        <div class="trip-card-head">
          <div class="trip-card-meta">
            <span class="trip-flag line">{{ CONTAINER_TYPE_LABELS[containerType] }}</span>
            <span
              class="trip-flag"
              :class="isLoaded ? 'loaded' : 'empty'"
            >{{ isLoaded ? 'Loaded' : 'Empty' }}</span>
          </div>

          <div class="trip-cno">
            {{ formatContainerNumber(normalized) }}
          </div>

          <div class="trip-facts">
            <div class="trip-fact">
              <small>Equipment</small>
              <b>{{ EQUIPMENT_TYPE_LABELS[equipmentType] }}</b>
            </div>
            <div class="trip-fact">
              <small>Chassis</small>
              <b>{{ selectedChassis?.number ?? 'None' }}</b>
            </div>
            <div class="trip-fact">
              <small>Seal</small>
              <b>{{ sealNumber || '—' }}</b>
            </div>
          </div>
        </div>

        <div class="route-strip">
          <div class="route-point">
            <small>Pickup</small>
            <strong>{{ originLocation?.name ?? '—' }}</strong>
          </div>
          <div
            class="route-arrow"
            aria-hidden="true"
          >
            →
          </div>
          <div class="route-point dest">
            <small>Drop-off</small>
            <strong>Chosen on arrival</strong>
          </div>
        </div>
      </div>

      <p class="banner info">
        <span aria-hidden="true">▸</span>
        <span>Confirming records the pickup, custody and departure events and moves the container into your custody.</span>
      </p>

      <button
        class="btn-primary-action"
        :disabled="submitting"
        @click="confirm"
      >
        {{ submitting ? 'Confirming…' : 'Confirm Pickup' }}
      </button>
    </template>

    <!-- ── Navigation ──────────────────────────────────────────── -->
    <div class="mt-6 flex gap-3">
      <button
        v-if="stepIndex > 0"
        type="button"
        class="btn-ghost flex-1"
        @click="back"
      >
        Back
      </button>

      <button
        v-if="step !== 'confirm'"
        type="button"
        class="btn-dark flex-1"
        :disabled="!canAdvance || submitting"
        @click="next"
      >
        {{ submitting ? 'Working…' : 'Continue' }}
      </button>
    </div>

    <button
      type="button"
      class="mt-4 w-full py-3 text-sm font-semibold text-[var(--color-err-600)]"
      @click="abandon"
    >
      {{ tripId ? 'Cancel this pickup' : 'Discard and go home' }}
    </button>
  </section>
</template>
