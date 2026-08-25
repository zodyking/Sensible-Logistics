<script setup lang="ts">
import { CONTAINER_TYPE_LABELS, EQUIPMENT_TYPE_LABELS, LOCATION_GLYPH, TRIP_STATUS_CHIP, TRIP_STATUS_LABELS } from '#shared/utils/domain'

const route = useRoute()
const tripId = computed(() => String(route.params.id))

const { data, status, error, refresh } = await useFetch(() => `/api/trips/${tripId.value}`)

useHead({ title: () => data.value?.trip.reference ?? 'Movement' })

const showDropoff = ref(false)
const destinationLocationId = ref<string | null>(null)
const retainChassis = ref(false)
const isFinalRelease = ref(false)
const placeInYard = ref(false)
const notes = ref('')
const submitting = ref(false)
const errorMessage = ref('')

const locationSearch = ref('')
const { data: locationData } = await useFetch('/api/locations', {
  query: computed(() => ({ q: locationSearch.value || undefined, limit: 50 })),
})

const destination = computed(() =>
  locationData.value?.items.find(l => l.id === destinationLocationId.value) ?? null)

const isLive = computed(() =>
  ['PICKUP_IN_PROGRESS', 'IN_TRANSIT', 'DROPOFF_IN_PROGRESS'].includes(data.value?.trip.status ?? ''))

async function completeDropoff() {
  if (!destinationLocationId.value || submitting.value) return
  submitting.value = true
  errorMessage.value = ''

  try {
    await $fetch(`/api/trips/${tripId.value}/dropoff`, {
      method: 'POST',
      body: {
        eventId: crypto.randomUUID(),
        destinationLocationId: destinationLocationId.value,
        // TODO(Phase 2): the Konva yard editor supplies real x/y/rotation.
        placement: placeInYard.value ? { x: 0, y: 0, rotation: 0 } : null,
        retainChassis: retainChassis.value,
        isFinalRelease: isFinalRelease.value,
        notes: notes.value || null,
      },
    })

    showDropoff.value = false
    await refresh()
  }
  catch (err) {
    errorMessage.value = apiErrorMessage(err, 'Could not complete the drop-off.')
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="d-page">
    <div
      v-if="status === 'pending'"
      class="card p-6 text-center text-sm text-[var(--color-ink-500)]"
      role="status"
    >
      Loading movement…
    </div>

    <p
      v-else-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ apiErrorMessage(error, 'Movement not found.') }}</span>
    </p>

    <template v-else-if="data">
      <PageHeader
        eyebrow="Active movement"
        :title="data.trip.reference"
        back-to="/pickups"
        back-label="Pickups"
      />

      <div class="mb-4 flex flex-wrap gap-2">
        <StatusChip
          :variant="TRIP_STATUS_CHIP[data.trip.status]"
          :label="TRIP_STATUS_LABELS[data.trip.status]"
        />
        <StatusChip
          :variant="data.trip.isLoaded ? 'ok' : 'idle'"
          :label="data.trip.isLoaded ? 'Loaded' : 'Empty'"
        />
        <StatusChip
          v-if="data.trip.isFinalRelease"
          variant="ok"
          plain
          label="Final release"
        />
      </div>

      <!-- ── Container card ──────────────────────────────────── -->
      <div class="trip-card">
        <div class="trip-card-head">
          <div class="trip-card-meta">
            <span class="trip-flag line">
              {{ data.container ? CONTAINER_TYPE_LABELS[data.container.containerType] : '—' }}
            </span>
            <span
              class="trip-flag"
              :class="data.trip.isLoaded ? 'loaded' : 'empty'"
            >
              {{ data.trip.isLoaded ? 'Loaded' : 'Empty' }}
            </span>
          </div>

          <NuxtLink
            v-if="data.container"
            :to="`/containers/${data.container.id}`"
            class="trip-cno block"
          >
            {{ data.container.number }}
          </NuxtLink>
          <div
            v-else
            class="trip-cno"
          >
            —
          </div>

          <div class="trip-facts">
            <div class="trip-fact">
              <small>Equipment</small>
              <b>{{ data.container ? EQUIPMENT_TYPE_LABELS[data.container.equipmentType] : '—' }}</b>
            </div>
            <div class="trip-fact">
              <small>Chassis</small>
              <b>{{ data.chassis?.number ?? 'None' }}</b>
            </div>
            <div class="trip-fact">
              <small>Seal</small>
              <b>{{ data.trip.sealNumber ?? '—' }}</b>
            </div>
          </div>
        </div>

        <div class="route-strip">
          <div class="route-point">
            <small>Origin</small>
            <strong>{{ data.origin?.name ?? 'Not set' }}</strong>
          </div>
          <div
            class="route-arrow"
            aria-hidden="true"
          >
            →
          </div>
          <div class="route-point dest">
            <small>Drop-off</small>
            <strong>{{ data.destination?.name ?? 'Not chosen' }}</strong>
          </div>
        </div>
      </div>

      <!-- ── Primary action ──────────────────────────────────── -->
      <template v-if="isLive">
        <button
          v-if="!showDropoff"
          class="btn-primary-action mb-4"
          @click="showDropoff = true"
        >
          Arrive &amp; Drop Off
        </button>

        <div
          v-else
          class="card mb-4 p-4"
        >
          <h2 class="mb-3 text-lg font-bold">
            Drop-off
          </h2>

          <p
            v-if="errorMessage"
            class="banner err"
            role="alert"
          >
            <span aria-hidden="true">✕</span>
            <span>{{ errorMessage }}</span>
          </p>

          <div class="searchbar">
            <span aria-hidden="true">⌕</span>
            <input
              v-model="locationSearch"
              type="search"
              placeholder="Search destination…"
              aria-label="Search destination locations"
            >
          </div>

          <div class="rowlist max-h-72 overflow-auto rounded-[var(--radius-md)] border border-[var(--color-line-200)]">
            <button
              v-for="location in locationData?.items ?? []"
              :key="location.id"
              type="button"
              class="row"
              :aria-pressed="destinationLocationId === location.id"
              @click="destinationLocationId = location.id"
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
                  v-if="destinationLocationId === location.id"
                  variant="ok"
                  label="Selected"
                />
              </span>
            </button>
          </div>

          <div class="mt-4 space-y-3">
            <label class="flex min-h-11 items-center gap-3 text-sm font-semibold">
              <input
                v-model="placeInYard"
                type="checkbox"
                class="size-5"
              >
              Record an exact yard position
            </label>
            <p
              v-if="placeInYard"
              class="banner warn mb-0"
            >
              <span aria-hidden="true">!</span>
              <span>The interactive 2D yard editor (Konva) lands in Phase 2. A placeholder placement is stored for now.</span>
            </p>

            <label class="flex min-h-11 items-center gap-3 text-sm font-semibold">
              <input
                v-model="retainChassis"
                type="checkbox"
                class="size-5"
                :disabled="!data.trip.chassisId"
              >
              Keep the chassis attached
            </label>

            <label class="flex min-h-11 items-center gap-3 text-sm font-semibold">
              <input
                v-model="isFinalRelease"
                type="checkbox"
                class="size-5"
              >
              Final release from the tracked network
            </label>

            <label class="field !mb-0">
              <span>Notes</span>
              <textarea
                v-model="notes"
                class="textarea"
                placeholder="Receiving contact, gate ticket number, exceptions…"
              />
            </label>
          </div>

          <p
            v-if="destination"
            class="banner info mt-4 mb-0"
          >
            <span aria-hidden="true">▸</span>
            <span>
              <b>{{ data.container?.number }} → {{ destination.name }}</b>
              {{ isFinalRelease
                ? 'This drop-off releases the container from the active pool.'
                : 'The container stays in the active pool at this location.' }}
            </span>
          </p>

          <div class="mt-4 flex gap-3">
            <button
              type="button"
              class="btn-ghost flex-1"
              @click="showDropoff = false"
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn-dark flex-1"
              :disabled="!destinationLocationId || submitting"
              @click="completeDropoff"
            >
              {{ submitting ? 'Saving…' : 'Complete drop-off' }}
            </button>
          </div>
        </div>
      </template>

      <!-- ── Yard map placeholder ────────────────────────────── -->
      <div class="section-label">
        <span>Yard placement</span>
      </div>
      <YardMapPlaceholder :location-name="data.destination?.name ?? data.origin?.name ?? null" />

      <!-- ── Timeline ────────────────────────────────────────── -->
      <div class="section-label">
        <span>Movement timeline</span>
      </div>

      <div
        v-if="data.timeline.length"
        class="card"
      >
        <EventTimeline :entries="data.timeline" />
      </div>

      <EmptyState
        v-else
        glyph="⇄"
        title="No events yet"
      />
    </template>
  </section>
</template>
