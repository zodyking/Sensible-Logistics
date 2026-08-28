<script setup lang="ts">
import {
  CONTAINER_STATUS_CHIP,
  CONTAINER_STATUS_LABELS,
  CONTAINER_TYPE_LABELS,
  EQUIPMENT_TYPE_SHORT,
} from '#shared/utils/domain'
import { formatChassisNumber, formatContainerNumber } from '#shared/utils/iso6346'

const route = useRoute()
const { data, status, error } = await useFetch(() => `/api/containers/${route.params.id}`)

useHead({ title: () => data.value?.container.number ?? 'Container' })

const backTo = computed(() => {
  const locationId = data.value?.currentLocation?.id
  return locationId ? `/locations/${locationId}` : '/containers'
})

const flags = computed(() => {
  const c = data.value?.container
  if (!c) return []
  return [
    c.isReefer && { label: 'Reefer', variant: 'transit' as const },
    c.isHazmat && { label: 'Hazmat', variant: 'err' as const },
    c.isOverweight && { label: 'Overweight', variant: 'warn' as const },
    c.isDamaged && { label: 'Damaged', variant: 'err' as const },
    c.customsHold && { label: 'Customs hold', variant: 'err' as const },
    c.isUrgent && { label: 'Urgent', variant: 'warn' as const },
    c.doNotMove && { label: 'Do not move', variant: 'err' as const },
  ].filter(Boolean) as Array<{ label: string, variant: 'transit' | 'err' | 'warn' }>
})

const serviceCaption = computed(() => {
  const life = data.value?.serviceLife
  if (!life) return 'Pickups and drop-offs for the current service life.'
  if (life.status === 'COMPLETE' && life.completedAt) {
    return `Service life complete · returned ${formatDateTime(life.completedAt)}`
  }
  if (life.startedAt) {
    return `Open service life · started ${formatDateTime(life.startedAt)}`
  }
  return 'Pickups and drop-offs for the current service life.'
})
</script>

<template>
  <section class="d-page">
    <div
      v-if="status === 'pending'"
      class="card p-6 text-center text-sm text-[var(--color-ink-500)]"
      role="status"
    >
      Loading container…
    </div>

    <p
      v-else-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ apiErrorMessage(error, 'Container not found.') }}</span>
    </p>

    <template v-else-if="data">
      <div class="backbar">
        <NuxtLink
          :to="backTo"
          class="backbtn"
        >
          ‹ {{ data.currentLocation?.name ? data.currentLocation.name : 'Locations' }}
        </NuxtLink>
      </div>

      <div class="card">
        <div class="cd-head">
          <span class="eyebrow">Container Record</span>
          <div class="container-no mono">
            {{ formatContainerNumber(data.container.number) || data.container.number }}
          </div>
          <div class="cd-chips">
            <StatusChip
              plain
              variant="idle"
              :label="EQUIPMENT_TYPE_SHORT[data.container.equipmentType]"
            />
            <StatusChip
              :variant="data.container.isLoaded ? 'ok' : 'idle'"
              :label="data.container.isLoaded ? 'Loaded' : 'Empty'"
            />
            <StatusChip
              :variant="CONTAINER_STATUS_CHIP[data.container.containerStatus]"
              :label="CONTAINER_STATUS_LABELS[data.container.containerStatus]"
            />
            <StatusChip
              plain
              variant="idle"
              :label="CONTAINER_TYPE_LABELS[data.container.containerType]"
            />
            <StatusChip
              variant="transit"
              :label="data.currentLocation ? `At ${data.currentLocation.name}` : (data.currentDriver ? `With ${data.currentDriver.name}` : 'In transit')"
            />
            <StatusChip
              v-for="flag in flags"
              :key="flag.label"
              :variant="flag.variant"
              :label="flag.label"
            />
          </div>
          <NuxtLink
            v-if="data.currentChassis"
            :to="`/chassis/${data.currentChassis.id}`"
            class="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-ink-700)]"
          >
            Chassis {{ formatChassisNumber(data.currentChassis.number) || data.currentChassis.number }} →
          </NuxtLink>
        </div>

        <div
          class="section-label"
          style="margin: 0; padding: var(--s2) var(--s4)"
        >
          Service history
        </div>
        <p class="px-4 pb-2 text-xs text-[var(--color-ink-500)]">
          {{ serviceCaption }}
        </p>

        <EventTimeline
          v-if="data.timeline.length"
          kind="service"
          :entries="data.timeline"
        />
        <EmptyState
          v-else
          glyph="⇄"
          title="No pickups or drop-offs yet"
          description="This record only lists pickups and drop-offs for the current service life — from a Marine Terminal or Rail Yard origin until return to a terminal."
        />

        <div
          v-if="data.documents.length"
          class="px-4 pb-4"
        >
          <div class="tl-docs">
            <span
              v-for="doc in data.documents"
              :key="doc.id"
              class="doc-chip"
              :class="{ photo: doc.category === 'PHOTO' }"
            >
              {{ doc.fileName }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
