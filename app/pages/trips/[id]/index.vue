<script setup lang="ts">
import { formatContainerNumber } from '#shared/utils/iso6346'

const route = useRoute()
const tripId = computed(() => String(route.params.id))

const { data, status, error } = await useFetch(() => `/api/trips/${tripId.value}`)

useHead({ title: () => data.value?.trip.reference ?? 'Trip' })

const isLive = computed(() =>
  ['PICKUP_IN_PROGRESS', 'IN_TRANSIT', 'DROPOFF_IN_PROGRESS'].includes(data.value?.trip.status ?? ''))

const pickupStamp = computed(() => data.value?.trip.pickedUpAt ?? null)
const dropoffStamp = computed(() => data.value?.trip.droppedOffAt ?? data.value?.trip.completedAt ?? null)
const durationLabel = computed(() => formatDurationBetween(pickupStamp.value, dropoffStamp.value))
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
      <PageHeader
        eyebrow="Trip"
        :title="data.trip.reference"
        back-to="/pickups"
        back-label="Trips"
      />
      <p
        v-if="durationLabel"
        class="trip-duration mb-4"
      >
        {{ durationLabel }}
      </p>

      <TripCard
        :trip-kind="data.trip.kind === 'BARE_CHASSIS' ? 'BARE_CHASSIS' : 'CONTAINER'"
        :container-type="data.container?.containerType"
        :is-loaded="data.trip.isLoaded"
        :container-number="data.container?.number"
        :equipment-type="data.container?.equipmentType"
        :chassis-number="data.chassis?.number"
        :seal-number="data.trip.sealNumber"
        :origin-name="data.origin?.name"
        :destination-name="data.destination?.name"
        :status="data.trip.status"
        :can-change-dropoff="isLive"
        @change-dropoff="navigateTo(`/trips/${tripId}/destination`)"
      >
        <template
          v-if="data.container"
          #number
        >
          <NuxtLink :to="`/containers/${data.container.id}`">
            {{ formatContainerNumber(data.container.number) || data.container.number }}
          </NuxtLink>
        </template>
      </TripCard>

      <div class="home-actions">
        <NuxtLink
          v-if="data.container"
          :to="`/containers/${data.container.id}`"
        >
          <span
            class="act-ico"
            aria-hidden="true"
          >▤</span>
          Documents
        </NuxtLink>
        <button type="button">
          <span
            class="act-ico"
            aria-hidden="true"
          >✉</span>
          Send SMS
        </button>
        <button type="button">
          <span
            class="act-ico"
            aria-hidden="true"
          >☎</span>
          Contacts
        </button>
        <NuxtLink
          v-if="data.container"
          :to="`/containers/${data.container.id}`"
        >
          <span
            class="act-ico"
            aria-hidden="true"
          >☰</span>
          History
        </NuxtLink>
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
