<script setup lang="ts">
import { CONTAINER_TYPE_LABELS, EQUIPMENT_TYPE_SHORT, LOCATION_TYPE_LABELS } from '#shared/utils/domain'
import { formatContainerNumber } from '#shared/utils/iso6346'
import { formatPhoneDisplay, toE164 } from '#shared/utils/phone'
import { bboxCenter, bboxFromPolygon, normalizeHeading, snapHeadingToStreet } from '#shared/utils/geo'
import type { GeoJsonPolygon } from '#shared/utils/geo'
import type { YardMapBox } from '~/components/LocationYardMap.vue'

const { user } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')

const route = useRoute()
const locationId = computed(() => String(route.params.id))

const { data, status, error, refresh } = await useFetch(() => `/api/locations/${locationId.value}`)

useHead({ title: () => data.value?.location.name ?? 'Location' })

const selectedId = ref<string | null>(null)
const placing = ref(false)
const pending = ref<YardMapBox | null>(null)
const aligning = ref(false)
const saving = ref(false)
const errorMessage = ref('')

const selected = computed(() => data.value?.containers.find(item => item.id === selectedId.value) ?? null)

function startReposition() {
  const box = selected.value
  if (!box) return
  const boundary = data.value?.location.boundary as GeoJsonPolygon | null
  const boxBounds = bboxFromPolygon(boundary)
  const center = boxBounds
    ? bboxCenter(boxBounds)
    : {
        latitude: data.value?.location.latitude ?? 0,
        longitude: data.value?.location.longitude ?? 0,
      }
  pending.value = {
    ...box,
    latitude: box.latitude ?? center.latitude,
    longitude: box.longitude ?? center.longitude,
    rotation: box.rotation ?? 0,
  }
  placing.value = true
  errorMessage.value = ''
}

function cancelReposition() {
  placing.value = false
  pending.value = null
}

function onPending(next: { latitude: number, longitude: number, rotation: number }) {
  if (!pending.value) return
  pending.value = { ...pending.value, ...next }
}

function rotate(delta: number) {
  if (!pending.value) return
  pending.value = { ...pending.value, rotation: normalizeHeading(pending.value.rotation + delta) }
}

async function alignToStreet() {
  if (!pending.value || pending.value.latitude == null || pending.value.longitude == null) return
  aligning.value = true
  try {
    const box = bboxFromPolygon(data.value?.location.boundary as GeoJsonPolygon | null)
    const result = await $fetch('/api/geocode/heading', {
      query: {
        lat: pending.value.latitude,
        lng: pending.value.longitude,
        west: box?.west,
        south: box?.south,
        east: box?.east,
        north: box?.north,
      },
    })
    pending.value = {
      ...pending.value,
      rotation: snapHeadingToStreet(pending.value.rotation, result.heading),
    }
  }
  catch (err) {
    errorMessage.value = apiErrorMessage(err, 'Could not read the nearby street.')
  }
  finally {
    aligning.value = false
  }
}

async function savePlacement() {
  if (!pending.value || pending.value.latitude == null || pending.value.longitude == null || saving.value) return
  saving.value = true
  errorMessage.value = ''
  try {
    await $fetch(`/api/locations/${locationId.value}/placements`, {
      method: 'POST',
      body: {
        eventId: crypto.randomUUID(),
        containerId: pending.value.id,
        placement: {
          latitude: pending.value.latitude,
          longitude: pending.value.longitude,
          rotation: pending.value.rotation,
        },
      },
    })
    placing.value = false
    pending.value = null
    await refresh()
  }
  catch (err) {
    errorMessage.value = apiErrorMessage(err, 'Could not save the placement.')
  }
  finally {
    saving.value = false
  }
}

function onSelect(id: string) {
  if (placing.value) return
  selectedId.value = id
}

const subtitle = computed(() => {
  const loc = data.value?.location
  if (!loc) return ''
  return [LOCATION_TYPE_LABELS[loc.type], loc.addressLine1, [loc.city, loc.state].filter(Boolean).join(', ')]
    .filter(Boolean)
    .join(' · ')
})
</script>

<template>
  <section :class="user?.role === 'ADMIN' ? '' : 'd-page'">
    <div
      v-if="status === 'pending'"
      class="card p-6 text-center text-sm text-[var(--color-ink-500)]"
      role="status"
    >
      Loading location…
    </div>

    <p
      v-else-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ apiErrorMessage(error, 'Location not found.') }}</span>
    </p>

    <template v-else-if="data">
      <PageHeader
        eyebrow="Location"
        :title="data.location.name"
        :back-to="user?.role === 'ADMIN' ? '/admin/locations' : '/more/locations'"
        :back-label="user?.role === 'ADMIN' ? 'Locations' : 'Manager'"
      />
      <p class="mb-4 text-sm text-[var(--color-ink-500)]">
        {{ subtitle }}
      </p>
      <div
        v-if="data.location.mainPhone || data.location.contactPhone"
        class="card mb-4 p-4 text-sm"
      >
        <p
          v-if="data.location.mainPhone"
          class="mb-0"
        >
          <span class="eyebrow">Main number</span>
          <a
            class="mt-1 block font-semibold"
            :href="`tel:${toE164(data.location.mainPhone)}`"
          >{{ formatPhoneDisplay(data.location.mainPhone) }}</a>
        </p>
        <p
          v-if="data.location.contactPhone"
          class="mb-0"
          :class="data.location.mainPhone ? 'mt-3' : ''"
        >
          <span class="eyebrow">Contact</span>
          <a
            class="mt-1 block font-semibold"
            :href="`tel:${toE164(data.location.contactPhone)}`"
          >
            <template v-if="data.location.contactName">{{ data.location.contactName }} · </template>
            {{ formatPhoneDisplay(data.location.contactPhone) }}
          </a>
        </p>
      </div>

      <p
        v-if="errorMessage"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ errorMessage }}</span>
      </p>

      <ClientOnly>
        <LocationYardMap
          :mode="placing ? 'place' : 'view'"
          :boundary="(data.location.boundary as GeoJsonPolygon | null) ?? null"
          :latitude="data.location.latitude"
          :longitude="data.location.longitude"
          :containers="data.containers"
          :pending="pending"
          :selected-id="selectedId"
          @select="onSelect"
          @update:pending="onPending"
        />
      </ClientOnly>

      <ContainerPlaceControls
        v-if="placing && pending"
        class="mt-3"
        :rotation="pending.rotation"
        :aligning="aligning"
        @rotate="rotate"
        @align="alignToStreet"
      />

      <div
        v-if="placing"
        class="mt-4 flex gap-3"
      >
        <button
          type="button"
          class="btn-ghost flex-1"
          @click="cancelReposition"
        >
          Cancel
        </button>
        <button
          type="button"
          class="btn-primary-action flex-1 !w-auto"
          :disabled="saving"
          @click="savePlacement"
        >
          {{ saving ? 'Saving…' : 'Save position' }}
        </button>
      </div>

      <div
        v-else
        class="mt-4"
      >
        <LocationTypeCounts
          :counts="data.typeCounts"
          :occupancy="data.occupancy"
        />
      </div>

      <NuxtLink
        v-if="!placing"
        :to="`/locations/${locationId}/add`"
        class="btn-dark mt-4 w-full"
      >
        Add a container
      </NuxtLink>

      <div
        v-if="selected && !placing"
        class="card mt-4 p-4"
      >
        <span class="eyebrow">Selected</span>
        <b class="mt-1 block font-mono text-lg">{{ formatContainerNumber(selected.number) || selected.number }}</b>
        <p class="mt-1 text-sm text-[var(--color-ink-500)]">
          {{ CONTAINER_TYPE_LABELS[selected.containerType] }}
          · {{ EQUIPMENT_TYPE_SHORT[selected.equipmentType] }}
          · {{ selected.isLoaded ? 'Loaded' : 'Empty' }}
        </p>
        <div class="mt-3 flex gap-3">
          <NuxtLink
            :to="`/containers/${selected.id}`"
            class="btn-ghost flex-1"
          >
            Open record
          </NuxtLink>
          <button
            type="button"
            class="btn-dark flex-1"
            @click="startReposition"
          >
            Move on map
          </button>
        </div>
      </div>

      <div class="section-label mt-6">
        <span>On site · {{ data.occupancy }}</span>
      </div>

      <div
        v-if="data.containers.length"
        class="card rowlist"
      >
        <button
          v-for="item in data.containers"
          :key="item.id"
          type="button"
          class="row"
          :aria-pressed="selectedId === item.id"
          @click="onSelect(item.id)"
        >
          <span
            class="type-swatch"
            :class="item.containerType"
            aria-hidden="true"
          />
          <span class="row-main">
            <b class="font-mono">{{ formatContainerNumber(item.number) || item.number }}</b>
            <small>
              {{ CONTAINER_TYPE_LABELS[item.containerType] }}
              · {{ EQUIPMENT_TYPE_SHORT[item.equipmentType] }}
              · {{ item.isLoaded ? 'Loaded' : 'Empty' }}
            </small>
          </span>
          <span
            class="row-end"
            aria-hidden="true"
          >›</span>
        </button>
      </div>

      <EmptyState
        v-else
        glyph="▣"
        title="No containers on site"
        description="Drop off from a trip or add a box and place it on the map."
      />
    </template>
  </section>
</template>
