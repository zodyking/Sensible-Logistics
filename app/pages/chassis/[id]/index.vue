<script setup lang="ts">
import { formatChassisNumber, formatContainerNumber } from '#shared/utils/iso6346'
import { visibleTimelineEntries } from '#shared/utils/timeline'

const route = useRoute()
const { user } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')
const { data, status, error } = await useFetch(() => `/api/chassis/${route.params.id}`)

useHead({ title: () => data.value?.chassis.number ?? 'Chassis' })

const menuOpen = ref(false)
const confirmOpen = ref(false)
const deleting = ref(false)
const actionError = ref('')
const editTo = computed(() => `/chassis/${route.params.id}/edit`)

const backTo = computed(() => {
  const locationId = data.value?.currentLocation?.id
  return locationId ? `/locations/${locationId}` : '/locations'
})

function closeMenu() {
  menuOpen.value = false
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
    await $fetch(`/api/chassis/${route.params.id}`, { method: 'DELETE' })
    confirmOpen.value = false
    await navigateTo(backTo.value)
  }
  catch (err) {
    actionError.value = apiErrorMessage(err, 'Could not delete this chassis.')
  }
  finally {
    deleting.value = false
  }
}

const serviceCaption = computed(() => {
  const life = data.value?.serviceLife
  if (!life) return 'Pickups, drop-offs, and chassis changes for the current service life.'
  if (life.status === 'COMPLETE' && life.completedAt) {
    return `Service life complete · returned ${formatDateTime(life.completedAt)}`
  }
  if (life.startedAt) {
    return `Open service life · started ${formatDateTime(life.startedAt)}`
  }
  return 'Pickups, drop-offs, and chassis changes for the current service life.'
})
const timeline = computed(() => visibleTimelineEntries(data.value?.timeline ?? []))
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
          :to="backTo"
          class="backbtn"
        >
          ‹ {{ data.currentLocation?.name ? data.currentLocation.name : 'Locations' }}
        </NuxtLink>
      </div>

      <div class="card">
        <div class="cd-head">
          <div class="cd-head-top">
            <span class="eyebrow">Chassis Record</span>
            <button
              type="button"
              class="icon-btn"
              aria-label="Chassis actions"
              aria-haspopup="menu"
              :aria-expanded="menuOpen"
              @click="menuOpen = true"
            >
              ⋮
            </button>
          </div>
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
          <NuxtLink
            :to="editTo"
            class="btn-ghost mt-3 w-full"
          >
            Edit information
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
          v-if="timeline.length"
          subject="chassis"
          :entries="timeline"
        />
        <EmptyState
          v-else
          glyph="⚭"
          title="No pickups, drop-offs, or chassis changes yet"
          description="This record lists pickups, drop-offs, and chassis hang or unhang for the current service life."
        />
      </div>

      <BottomSheet
        :open="menuOpen"
        title="Chassis"
        @close="menuOpen = false"
      >
        <NuxtLink
          :to="editTo"
          class="menu-row"
          role="menuitem"
          @click="closeMenu"
        >
          Edit
        </NuxtLink>
        <button
          type="button"
          class="menu-row danger"
          @click="requestDelete"
        >
          Delete
        </button>
      </BottomSheet>

      <BottomSheet
        :open="confirmOpen"
        title="Delete chassis?"
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
          This chassis will be removed from the company pool. Trip history stays. This cannot be undone.
        </p>
        <div class="sheet-actions">
          <button
            type="button"
            class="btn-cancel"
            :disabled="deleting"
            @click="confirmOpen = false"
          >
            Keep chassis
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
