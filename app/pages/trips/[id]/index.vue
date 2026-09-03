<script setup lang="ts">
import {
  canRemoveFromTripHistory,
  CONTAINER_TYPE_LABELS,
  EQUIPMENT_TYPE_SHORT,
  isLiveTripStatus,
  TRIP_KIND_LABELS,
  TRIP_STATUS_CHIP,
  TRIP_STATUS_LABELS,
} from '#shared/utils/domain'
import { formatChassisNumber, formatContainerNumber } from '#shared/utils/iso6346'
import { tripSmsAction } from '#shared/utils/trip-sms'
import { visibleTimelineEntries } from '#shared/utils/timeline'
import { invalidateTripLists } from '~/utils/trip-lists'

const route = useRoute()
const tripId = computed(() => String(route.params.id))

const { data, status, error } = await useFetch(() => `/api/trips/${tripId.value}`)

useHead({ title: () => data.value?.trip.reference ?? 'Trip' })

const isLive = computed(() => isLiveTripStatus(data.value?.trip.status))
const canDelete = computed(() => canRemoveFromTripHistory(data.value?.trip.status))
const confirmDeleteOpen = ref(false)
const deleting = ref(false)
const deleteError = ref('')

async function confirmDelete() {
  if (deleting.value || !canDelete.value) return
  deleting.value = true
  deleteError.value = ''
  try {
    await $fetch(`/api/trips/${tripId.value}`, { method: 'DELETE' })
    invalidateTripLists()
    confirmDeleteOpen.value = false
    await navigateTo('/pickups')
  }
  catch (err) {
    deleteError.value = apiErrorMessage(err, 'Could not delete this trip.')
  }
  finally {
    deleting.value = false
  }
}

const pickupStamp = computed(() => data.value?.trip.pickedUpAt ?? null)
const dropoffStamp = computed(() => data.value?.trip.droppedOffAt ?? data.value?.trip.completedAt ?? null)
const durationLabel = computed(() => formatDurationBetween(pickupStamp.value, dropoffStamp.value))
const smsOpen = ref(false)
const contactsOpen = ref(false)
const canSendSms = computed(() => Boolean(tripSmsAction(data.value?.trip.status)))
const timeline = computed(() => visibleTimelineEntries(data.value?.timeline ?? []))

const isBareChassis = computed(() =>
  data.value?.trip.kind === 'BARE_CHASSIS' || (!data.value?.container && Boolean(data.value?.chassis)),
)

const titleNumber = computed(() => {
  if (data.value?.container) {
    return formatContainerNumber(data.value.container.number) || data.value.container.number
  }
  if (data.value?.chassis) {
    return formatChassisNumber(data.value.chassis.number) || data.value.chassis.number
  }
  return data.value?.trip.reference ?? 'Trip'
})

const typeLabel = computed(() => {
  if (isBareChassis.value) return TRIP_KIND_LABELS.BARE_CHASSIS
  const type = data.value?.container?.containerType
  return type ? CONTAINER_TYPE_LABELS[type] : '—'
})

const loadLabel = computed(() => {
  if (isBareChassis.value) return 'Bare chassis'
  return data.value?.trip.isLoaded ? 'Loaded' : 'Empty'
})

const lengthLabel = computed(() => {
  const equipment = data.value?.container?.equipmentType
  return equipment ? EQUIPMENT_TYPE_SHORT[equipment] : null
})

const chassisDisplay = computed(() => {
  if (!data.value?.chassis) return 'None'
  return formatChassisNumber(data.value.chassis.number) || data.value.chassis.number
})

function placeLabel(name?: string | null, city?: string | null) {
  const trimmed = name?.trim()
  if (!trimmed) return { name: 'Not set', city: city?.trim() || '' }
  return { name: trimmed, city: city?.trim() || '' }
}

const pickupPlace = computed(() => placeLabel(data.value?.origin?.name, data.value?.origin?.city))
const dropoffPlace = computed(() => {
  const place = placeLabel(data.value?.destination?.name, data.value?.destination?.city)
  if (!data.value?.destination?.name?.trim()) {
    return { name: 'Choose at drop-off', city: place.city }
  }
  return place
})
</script>

<template>
  <section class="d-page">
    <div
      v-if="status === 'pending'"
      class="card p-6 text-center text-sm text-[var(--color-ink-500)]"
      role="status"
    >
      Loading trip…
    </div>

    <p
      v-else-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ apiErrorMessage(error, 'Trip not found.') }}</span>
    </p>

    <template v-else-if="data">
      <div class="backbar">
        <NuxtLink
          to="/pickups"
          class="backbtn"
        >
          ‹ Trips
        </NuxtLink>
      </div>

      <div class="card trip-record-card">
        <div class="cd-head">
          <div class="cd-head-top">
            <span class="eyebrow">Trip Record</span>
            <StatusChip
              :variant="TRIP_STATUS_CHIP[data.trip.status]"
              :label="TRIP_STATUS_LABELS[data.trip.status]"
            />
          </div>
          <div class="container-no mono">
            {{ titleNumber }}
          </div>
          <p
            v-if="durationLabel"
            class="trip-duration"
          >
            {{ durationLabel }}
          </p>
          <div class="cd-chips">
            <StatusChip
              v-if="lengthLabel"
              plain
              variant="idle"
              :label="lengthLabel"
            />
            <StatusChip
              plain
              variant="idle"
              :label="typeLabel"
            />
            <StatusChip
              :variant="data.trip.isLoaded ? 'ok' : 'idle'"
              :label="loadLabel"
            />
            <StatusChip
              plain
              variant="idle"
              :label="data.trip.reference"
            />
          </div>
        </div>

        <dl class="trip-spec">
          <div
            v-if="!isBareChassis"
            class="trip-spec-row"
          >
            <dt>Container</dt>
            <dd>
              <CopyMarking
                v-if="data.container"
                kind="container"
                :value="data.container.number"
                :display="formatContainerNumber(data.container.number) || data.container.number"
              />
              <span v-else>—</span>
              <NuxtLink
                v-if="data.container"
                :to="`/containers/${data.container.id}`"
                class="trip-spec-open"
              >
                Open
              </NuxtLink>
            </dd>
          </div>
          <div class="trip-spec-row">
            <dt>Chassis</dt>
            <dd>
              <CopyMarking
                v-if="data.chassis"
                kind="chassis"
                :value="data.chassis.number"
                :display="chassisDisplay"
              />
              <span v-else>None</span>
              <NuxtLink
                v-if="data.chassis"
                :to="`/chassis/${data.chassis.id}`"
                class="trip-spec-open"
              >
                Open
              </NuxtLink>
            </dd>
          </div>
          <div
            v-if="!isBareChassis"
            class="trip-spec-row"
          >
            <dt>Seal</dt>
            <dd>
              <CopyMarking
                v-if="data.trip.sealNumber"
                kind="seal"
                :value="data.trip.sealNumber"
              />
              <span v-else>—</span>
            </dd>
          </div>
          <div class="trip-spec-row">
            <dt>Type</dt>
            <dd>{{ typeLabel }}</dd>
          </div>
          <div class="trip-spec-row">
            <dt>Load</dt>
            <dd>{{ loadLabel }}</dd>
          </div>
          <div class="trip-spec-row">
            <dt>Pickup</dt>
            <dd>
              <strong>{{ pickupPlace.name }}</strong>
              <small v-if="pickupPlace.city">{{ pickupPlace.city }}</small>
            </dd>
          </div>
          <div class="trip-spec-row">
            <dt>Drop-off</dt>
            <dd>
              <strong>{{ dropoffPlace.name }}</strong>
              <small v-if="dropoffPlace.city">{{ dropoffPlace.city }}</small>
              <button
                v-if="isLive"
                type="button"
                class="trip-spec-open"
                @click="navigateTo(`/trips/${tripId}/destination`)"
              >
                Change
              </button>
            </dd>
          </div>
        </dl>

        <div class="trip-spec-actions">
          <NuxtLink
            v-if="data.container"
            :to="`/containers/${data.container.id}`"
            class="menu-row"
          >
            Documents
          </NuxtLink>
          <button
            type="button"
            class="menu-row"
            :disabled="!canSendSms"
            @click="smsOpen = true"
          >
            Send SMS
          </button>
          <button
            type="button"
            class="menu-row"
            :disabled="!data.origin && !data.destination"
            @click="contactsOpen = true"
          >
            Contacts
          </button>
          <NuxtLink
            v-if="data.container"
            :to="`/containers/${data.container.id}`"
            class="menu-row"
          >
            History
          </NuxtLink>
          <button
            v-if="canDelete"
            type="button"
            class="menu-row danger"
            @click="confirmDeleteOpen = true"
          >
            Delete trip
          </button>
        </div>
      </div>

      <NuxtLink
        v-if="isLive && data.chassis && !data.container && data.trip.status !== 'PICKUP_IN_PROGRESS'"
        to="/pickups/attach"
        class="btn-dark home-cta mb-3"
      >
        Add container to chassis
      </NuxtLink>

      <NuxtLink
        v-if="isLive"
        :to="`/trips/${tripId}/dropoff`"
        class="btn-primary-action home-cta mb-4"
      >
        Arrive
      </NuxtLink>

      <div class="section-label">
        <span>Dispatch</span>
      </div>
      <DispatchTaskCard
        v-for="task in data.tasks"
        :id="task.id"
        :key="task.id"
        :title="task.title"
        :raw-text="task.rawText"
        :sender="task.sender"
        :received-at="task.receivedAt"
        :work-date="task.workDate"
        :kind="task.kind"
        :status="task.status"
        :trip-id="task.tripId"
        :steps="task.steps"
        compact
      />
      <EmptyState
        v-if="!data.tasks?.length"
        glyph="☰"
        title="No dispatch for this trip"
        description="Dispatcher texts for this work date will attach here."
      />

      <div class="section-label">
        <span>Movement timeline</span>
      </div>

      <div
        v-if="timeline.length"
        class="card"
      >
        <EventTimeline :entries="timeline" />
      </div>

      <EmptyState
        v-else
        glyph="⇄"
        title="No pickups, drop-offs, or chassis changes yet"
      />

      <TripSmsSheet
        :open="smsOpen"
        :trip-id="data.trip.id"
        :status="data.trip.status"
        :is-loaded="data.trip.isLoaded"
        :container-number="data.container?.number"
        :seal-number="data.trip.sealNumber"
        :chassis-number="data.chassis?.number"
        :container-type="data.container?.containerType"
        :origin-name="data.origin?.name"
        :destination-name="data.destination?.name"
        :customer="data.trip.customer"
        @close="smsOpen = false"
      />

      <TripContactsSheet
        :open="contactsOpen"
        :origin="data.origin"
        :destination="data.destination"
        @close="contactsOpen = false"
      />

      <BottomSheet
        :open="confirmDeleteOpen"
        title="Delete trip?"
        @close="confirmDeleteOpen = false"
      >
        <p
          v-if="deleteError"
          class="banner err"
          role="alert"
        >
          <span aria-hidden="true">✕</span>
          <span>{{ deleteError }}</span>
        </p>
        <p class="text-sm text-[var(--color-ink-700)]">
          This trip will be removed from history. This cannot be undone.
        </p>
        <div class="sheet-actions">
          <button
            type="button"
            class="btn-cancel"
            :disabled="deleting"
            @click="confirmDeleteOpen = false"
          >
            Keep trip
          </button>
          <button
            type="button"
            class="btn-save danger"
            :disabled="deleting"
            @click="confirmDelete"
          >
            {{ deleting ? 'Deleting…' : 'Delete trip' }}
          </button>
        </div>
      </BottomSheet>
    </template>
  </section>
</template>
