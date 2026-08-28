<script setup lang="ts">
import { formatChassisNumber, formatContainerNumber } from '#shared/utils/iso6346'

const route = useRoute()
const { data, status, error } = await useFetch(() => `/api/chassis/${route.params.id}`)

useHead({ title: () => data.value?.chassis.number ?? 'Chassis' })

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
      Loading chassis…
    </div>

    <p
      v-else-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ apiErrorMessage(error, 'Chassis not found.') }}</span>
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

      <div class="card">
        <div class="cd-head">
          <span class="eyebrow">Chassis Record</span>
          <div class="container-no mono">
            {{ formatChassisNumber(data.chassis.number) || data.chassis.number }}
          </div>
          <div class="cd-chips">
            <StatusChip
              v-if="data.chassis.sizeCompatibility"
              plain
              variant="idle"
              :label="data.chassis.sizeCompatibility"
            />
            <StatusChip
              :variant="data.chassis.status === 'IN_USE' ? 'transit' : (data.chassis.outOfService ? 'err' : 'ok')"
              :label="data.chassis.outOfService ? 'Out of service' : (data.chassis.status === 'IN_USE' ? 'In use' : 'Available')"
            />
            <StatusChip
              v-if="data.chassis.provider"
              plain
              variant="idle"
              :label="data.chassis.provider"
            />
            <StatusChip
              v-if="data.currentLocation"
              variant="transit"
              :label="`At ${data.currentLocation.name}`"
            />
          </div>
          <NuxtLink
            v-if="data.currentContainer"
            :to="`/containers/${data.currentContainer.id}`"
            class="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-ink-700)]"
          >
            Container {{ formatContainerNumber(data.currentContainer.number) || data.currentContainer.number }} →
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
          glyph="⚭"
          title="No pickups or drop-offs yet"
          description="This record only lists pickups and drop-offs for the current service life — from a marine or rail origin until return to a terminal."
        />
      </div>
    </template>
  </section>
</template>
