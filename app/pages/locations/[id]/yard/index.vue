<script setup lang="ts">
import type { YardLayoutOrigin } from '#shared/utils/yard-plan'
import type { ContainerType, EquipmentType } from '#shared/utils/domain'

const { user } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')

const route = useRoute()
const locationId = computed(() => String(route.params.id))

const { data: locationData, error: locationError, status: locationStatus, refresh: refreshLocation } = await useFetch(
  () => `/api/locations/${locationId.value}`,
)
const { data: yard, error: yardError, status: yardStatus, refresh: refreshYard } = await useFetch(
  () => `/api/locations/${locationId.value}/yard`,
)

useHead({ title: () => `${yard.value?.location.name ?? 'Location'} · Yard` })

const origin = computed<YardLayoutOrigin | null>(() => {
  const layout = yard.value?.layout
  if (!layout || layout.status !== 'READY' || layout.originLng == null || layout.originLat == null) return null
  return {
    originLng: layout.originLng,
    originLat: layout.originLat,
    planeWidth: layout.planeWidth,
    planeHeight: layout.planeHeight,
    rotationDeg: layout.rotationDeg,
  }
})

const containers = computed(() => (locationData.value?.containers ?? []).map(item => ({
  id: item.id,
  number: item.number,
  containerType: item.containerType as ContainerType,
  equipmentType: item.equipmentType as EquipmentType,
  isLoaded: Boolean(item.isLoaded),
  latitude: item.latitude != null ? Number(item.latitude) : null,
  longitude: item.longitude != null ? Number(item.longitude) : null,
  rotation: item.rotation ?? 0,
})))

const unplacedChassis = computed(() =>
  (yard.value?.chassisPositions ?? []).filter(item => item.x == null || item.y == null),
)

function placeChassisOnPavement(id: string) {
  if (!origin.value) return
  const layout = yard.value?.layout
  if (!layout) return
  return $fetch(`/api/locations/${locationId.value}/yard/chassis/${id}`, {
    method: 'PUT',
    body: {
      x: layout.planeWidth / 2,
      y: layout.planeHeight / 2,
      rotation: layout.rotationDeg,
    },
  }).then(() => refreshYard())
}

async function onMoved() {
  await Promise.all([refreshLocation(), refreshYard()])
}
</script>

<template>
  <section :class="user?.role === 'ADMIN' ? '' : 'd-page'">
    <PageHeader
      eyebrow="Yard"
      :title="yard?.location.name ?? 'Yard'"
      :back-to="`/locations/${locationId}`"
      back-label="Location"
    >
      <template #actions>
        <NuxtLink
          :to="`/locations/${locationId}/yard/setup`"
          class="btn-ghost"
        >
          {{ origin ? 'Regenerate' : 'Draw zone' }}
        </NuxtLink>
      </template>
    </PageHeader>

    <p
      v-if="locationError || yardError"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ apiErrorMessage(locationError || yardError, 'Could not load this yard.') }}</span>
    </p>

    <div
      v-else-if="locationStatus === 'pending' || yardStatus === 'pending'"
      class="card p-6 text-center text-sm text-[var(--color-ink-500)]"
      role="status"
    >
      Loading yard…
    </div>

    <template v-else-if="yard?.layout?.status === 'GENERATING'">
      <p class="wiz-hint">
        Building the site plan from OpenStreetMap and aerial imagery…
      </p>
    </template>

    <template v-else-if="yard?.layout?.status === 'FAILED'">
      <p class="banner err">
        <span aria-hidden="true">✕</span>
        <span>{{ yard.layout.errorMessage || 'Generation failed.' }}</span>
      </p>
      <NuxtLink
        :to="`/locations/${locationId}/yard/setup`"
        class="btn-dark mt-4"
      >
        Try again
      </NuxtLink>
    </template>

    <template v-else-if="!origin">
      <EmptyState
        glyph="▦"
        :title="locationData?.location.boundary ? 'Zone saved — no 2D plan yet' : 'No yard plan yet'"
        :description="locationData?.location.boundary
          ? 'This site already has a yard zone. Generate the clean 2D plan from it, or redraw the zone first.'
          : 'Draw a zone around the usable yard. The app builds a clean 2D site plan from that boundary — not a satellite photo.'"
      />
      <NuxtLink
        :to="`/locations/${locationId}/yard/setup`"
        class="btn-dark mt-4"
      >
        {{ locationData?.location.boundary ? 'Generate 2D yard' : 'Draw zone and generate' }}
      </NuxtLink>
    </template>

    <template v-else>
      <p
        v-if="yard?.layout?.errorMessage"
        class="note"
        role="status"
      >
        <span>{{ yard.layout.errorMessage }}</span>
      </p>

      <ClientOnly>
        <YardView
          :location-id="locationId"
          :origin="origin"
          :features="yard.features"
          :slots="yard.slots"
          :containers="containers"
          :chassis="yard.chassisPositions"
          :can-edit="user?.role === 'ADMIN'"
          @moved="onMoved"
        />
      </ClientOnly>

      <template v-if="unplacedChassis.length">
        <div class="section-label mt-6">
          <span>Chassis not on the plan</span>
        </div>
        <div class="card rowlist">
          <button
            v-for="item in unplacedChassis"
            :key="item.id"
            type="button"
            class="row"
            @click="placeChassisOnPavement(item.id)"
          >
            <span class="row-main">
              <b class="font-mono">{{ item.number }}</b>
              <small>Tap to drop onto the yard, then drag into place</small>
            </span>
            <span
              class="row-end"
              aria-hidden="true"
            >›</span>
          </button>
        </div>
      </template>
    </template>
  </section>
</template>
