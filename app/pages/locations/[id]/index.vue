<script setup lang="ts">
import { CONTAINER_TYPE_LABELS, EQUIPMENT_TYPE_SHORT, LOCATION_TYPE_LABELS } from '#shared/utils/domain'
import { formatChassisNumber, formatContainerNumber } from '#shared/utils/iso6346'
import { formatPhoneDisplay, toE164 } from '#shared/utils/phone'
import { SHIPCSX_CHECK_TIMEOUT_MS } from '#shared/utils/csx-lookup'
import { shipcsxPublicError } from '#shared/utils/shipcsx-status'

const { user } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')

const route = useRoute()
const locationId = computed(() => String(route.params.id))

const { data, status, error, refresh } = await useFetch(() => `/api/locations/${locationId.value}`)
const checkingCsx = ref(false)
const csxError = ref('')

const isTerminus = computed(() => {
  const type = data.value?.location.type
  return type === 'MARINE_TERMINAL' || type === 'RAIL_TERMINAL'
})
const isCustomer = computed(() => data.value?.location.type === 'CUSTOMER')

function snapshotFor(containerId: string) {
  return data.value?.csxSnapshots?.find(row => row.containerId === containerId) ?? null
}

async function checkLocationCsx() {
  if (checkingCsx.value) return
  checkingCsx.value = true
  csxError.value = ''
  try {
    await $fetch(`/api/locations/${locationId.value}/shipcsx`, {
      method: 'POST',
      timeout: SHIPCSX_CHECK_TIMEOUT_MS,
    })
    await refresh()
  }
  catch (err) {
    csxError.value = shipcsxPublicError(apiErrorMessage(err, 'Could not check ShipCSX.'))
  }
  finally {
    checkingCsx.value = false
  }
}

async function cancelRelease(releaseId: string) {
  try {
    await $fetch(`/api/locations/${locationId.value}/csx-releases/${releaseId}`, { method: 'DELETE' })
    await refresh()
  }
  catch (err) {
    csxError.value = apiErrorMessage(err, 'Could not cancel that release.')
  }
}

useHead({ title: () => data.value?.location.name ?? 'Location' })

const menuOpen = ref(false)
const confirmOpen = ref(false)
const deleting = ref(false)
const actionError = ref('')

const subtitle = computed(() => {
  const loc = data.value?.location
  if (!loc) return ''
  if (loc.isUncategorized) return 'Holding site for equipment from deleted locations'
  return [LOCATION_TYPE_LABELS[loc.type], loc.addressLine1, [loc.city, loc.state].filter(Boolean).join(', ')]
    .filter(Boolean)
    .join(' · ')
})

function openEdit() {
  menuOpen.value = false
  navigateTo(`/locations/${locationId.value}/edit`)
}

function requestDelete() {
  menuOpen.value = false
  actionError.value = ''
  confirmOpen.value = true
}

async function confirmDelete() {
  if (deleting.value) return
  deleting.value = true
  actionError.value = ''
  try {
    const result = await $fetch<{
      uncategorizedLocationId: string
      movedContainers: number
      movedChassis: number
    }>(`/api/locations/${locationId.value}`, { method: 'DELETE' })
    confirmOpen.value = false
    const moved = result.movedContainers + result.movedChassis
    await navigateTo(moved ? `/locations/${result.uncategorizedLocationId}` : '/locations')
  }
  catch (err) {
    actionError.value = apiErrorMessage(err, 'Could not delete this location.')
  }
  finally {
    deleting.value = false
  }
}
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
        back-to="/locations"
        back-label="Locations"
      >
        <template #actions>
          <button
            type="button"
            class="icon-btn"
            aria-label="Location actions"
            aria-haspopup="menu"
            :aria-expanded="menuOpen"
            @click="menuOpen = true"
          >
            ⋮
          </button>
        </template>
      </PageHeader>
      <p class="mb-4 flex items-center gap-2 text-sm text-[var(--color-ink-500)]">
        <LocationIcon
          v-if="!data.location.isUncategorized"
          :name="data.location.type"
          :size="20"
        />
        <span>{{ subtitle }}</span>
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

      <LocationTypeCounts
        class="mt-4"
        :counts="data.typeCounts"
        :occupancy="data.occupancy"
      />

      <p
        v-if="csxError"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ csxError }}</span>
      </p>

      <NuxtLink
        :to="`/locations/${locationId}/add`"
        class="btn-dark mt-4 w-full"
      >
        Add Equipment
      </NuxtLink>
      <NuxtLink
        v-if="isTerminus"
        :to="`/locations/${locationId}/csx`"
        class="btn-ghost mt-2 w-full"
      >
        Upload CSX pickup list
      </NuxtLink>
      <button
        v-if="isCustomer && data.containers.length"
        type="button"
        class="btn-ghost mt-2 w-full"
        :disabled="checkingCsx"
        @click="checkLocationCsx"
      >
        {{ checkingCsx ? 'Checking ShipCSX…' : 'Check CSX' }}
      </button>
      <NuxtLink
        v-if="!data.location.isUncategorized && !data.location.boundary"
        :to="`/locations/${locationId}/yard/setup`"
        class="btn-ghost mt-2 w-full"
      >
        Draw yard zone
      </NuxtLink>
      <NuxtLink
        v-if="!data.location.isUncategorized"
        :to="`/locations/${locationId}/yard`"
        class="btn-ghost mt-2 w-full"
      >
        Yard
      </NuxtLink>

      <template v-if="isTerminus">
        <div class="section-label mt-6">
          <span>CSX empties · {{ data.csxReleases?.length ?? 0 }}</span>
        </div>
        <div
          v-if="data.csxReleases?.length"
          class="card rowlist"
        >
          <div
            v-for="item in data.csxReleases"
            :key="item.id"
            class="row"
          >
            <span class="row-main">
              <b class="font-mono">{{ formatContainerNumber(item.containerNumber) || item.containerNumber }}</b>
              <small>Pickup {{ item.pickupNumber }}</small>
            </span>
            <button
              type="button"
              class="trip-spec-open"
              @click="cancelRelease(item.id)"
            >
              Cancel
            </button>
          </div>
        </div>
        <EmptyState
          v-else
          glyph="┼"
          title="No CSX pickups listed"
          description="Empties to pull from this terminal go here. They do not stay on the yard after a return."
        />
      </template>

      <div class="section-label mt-6">
        <span>On site · {{ data.occupancy }}</span>
      </div>

      <div
        v-if="data.containers.length"
        class="card rowlist"
      >
        <NuxtLink
          v-for="item in data.containers"
          :key="item.id"
          :to="`/containers/${item.id}`"
          class="row"
        >
          <span
            class="type-swatch"
            :class="item.containerType"
            aria-hidden="true"
          />
          <span class="row-main">
            <span class="row-titleline">
              <b class="font-mono">{{ formatContainerNumber(item.number) || item.number }}</b>
              <span
                v-if="item.occupancy"
                class="row-occupancy"
              >
                <em>{{ item.occupancy.daysLabel }}</em>
                <small>{{ item.occupancy.pickedUpLabel }}</small>
              </span>
            </span>
            <small>
              {{ CONTAINER_TYPE_LABELS[item.containerType] }}
              · {{ EQUIPMENT_TYPE_SHORT[item.equipmentType] }}
              · {{ item.isLoaded ? 'Loaded' : 'Empty' }}
              <template v-if="item.chassisNumber"> · {{ formatChassisNumber(item.chassisNumber) }}</template>
              <template v-if="snapshotFor(item.id)?.inGateReadiness">
                · {{ snapshotFor(item.id)?.inGateReadiness }}
              </template>
            </small>
          </span>
          <span
            class="row-end"
            aria-hidden="true"
          >›</span>
        </NuxtLink>
      </div>

      <EmptyState
        v-else
        glyph="▣"
        title="No containers on site"
        description="Drop off from a trip or add equipment here."
      />

      <template v-if="data.chassis?.length">
        <div class="section-label mt-6">
          <span>Chassis · {{ data.chassis.length }}</span>
        </div>
        <div class="card rowlist">
          <NuxtLink
            v-for="item in data.chassis"
            :key="item.id"
            :to="`/chassis/${item.id}`"
            class="row"
          >
            <span class="row-main">
              <b class="font-mono">{{ formatChassisNumber(item.number) || item.number }}</b>
              <small>{{ [item.provider, item.sizeCompatibility].filter(Boolean).join(' · ') || 'Available' }}</small>
            </span>
            <span
              class="row-end"
              aria-hidden="true"
            >›</span>
          </NuxtLink>
        </div>
      </template>

      <BottomSheet
        :open="menuOpen"
        title="Location"
        @close="menuOpen = false"
      >
        <button
          v-if="!data.location.isUncategorized"
          type="button"
          class="menu-row"
          @click="menuOpen = false; navigateTo(`/locations/${locationId}/yard`)"
        >
          Yard
        </button>
        <button
          v-if="!data.location.isUncategorized && !data.location.boundary"
          type="button"
          class="menu-row"
          @click="menuOpen = false; navigateTo(`/locations/${locationId}/yard/setup`)"
        >
          Draw yard zone
        </button>
        <button
          type="button"
          class="menu-row"
          @click="openEdit"
        >
          Edit
        </button>
        <button
          v-if="!data.location.isUncategorized"
          type="button"
          class="menu-row danger"
          @click="requestDelete"
        >
          Delete
        </button>
      </BottomSheet>

      <BottomSheet
        :open="confirmOpen"
        title="Delete location?"
        @close="confirmOpen = false"
      >
        <p
          v-if="actionError"
          class="banner err"
          role="alert"
        >
          <span aria-hidden="true">✕</span>
          <span>{{ actionError }}</span>
        </p>
        <p class="text-sm text-[var(--color-ink-700)]">
          <template v-if="data.occupancy">
            Containers and chassis here will move to Uncategorized. This cannot be undone.
          </template>
          <template v-else>
            This location will be removed from the company pool. This cannot be undone.
          </template>
        </p>
        <div class="sheet-actions">
          <button
            type="button"
            class="btn-cancel"
            :disabled="deleting"
            @click="confirmOpen = false"
          >
            Keep location
          </button>
          <button
            type="button"
            class="btn-save danger"
            :disabled="deleting"
            @click="confirmDelete"
          >
            {{ deleting ? 'Deleting…' : 'Delete' }}
          </button>
        </div>
      </BottomSheet>
    </template>
  </section>
</template>
