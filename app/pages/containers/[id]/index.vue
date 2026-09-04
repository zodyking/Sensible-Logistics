<script setup lang="ts">
import {
  CONTAINER_STATUS_CHIP,
  CONTAINER_STATUS_LABELS,
  CONTAINER_TYPE_LABELS,
  EQUIPMENT_TYPE_SHORT,
} from '#shared/utils/domain'
import { formatChassisNumber, formatContainerNumber } from '#shared/utils/iso6346'
import { visibleTimelineEntries } from '#shared/utils/timeline'
import { shipcsxCheckProgressLine } from '#shared/utils/shipcsx-check'
import { shipcsxMetaLine, shipcsxPublicError, shipcsxStatusLabel } from '#shared/utils/shipcsx-status'

const route = useRoute()
const { user } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')
const { data, status, error, refresh } = await useFetch(() => `/api/containers/${route.params.id}`)
const liveCheck = ref(data.value?.shipcsxCheck ?? null)
const csxError = ref('')
let checkTimer: ReturnType<typeof setInterval> | null = null

const checkingCsx = computed(() => liveCheck.value?.status === 'running')

async function pollCsxProgress() {
  try {
    const result = await $fetch<{
      check: typeof liveCheck.value
      snapshot: unknown
    }>(`/api/containers/${route.params.id}/shipcsx`)
    liveCheck.value = result.check
    if (result.check?.status !== 'running') {
      stopCsxPoll()
      await refresh()
    }
  }
  catch (err) {
    csxError.value = shipcsxPublicError(apiErrorMessage(err, 'Could not check ShipCSX.'))
    stopCsxPoll()
  }
}

function startCsxPoll() {
  if (checkTimer) return
  checkTimer = setInterval(pollCsxProgress, 1200)
  void pollCsxProgress()
}

function stopCsxPoll() {
  if (!checkTimer) return
  clearInterval(checkTimer)
  checkTimer = null
}

watch(() => data.value?.shipcsxCheck, (check) => {
  if (check) liveCheck.value = check
  if (check?.status === 'running') startCsxPoll()
}, { immediate: true })

onMounted(() => {
  if (liveCheck.value?.status === 'running') startCsxPoll()
})
onUnmounted(stopCsxPoll)

useHead({ title: () => data.value?.container.number ?? 'Container' })

const menuOpen = ref(false)
const confirmOpen = ref(false)
const deleting = ref(false)
const actionError = ref('')
const editTo = computed(() => `/containers/${route.params.id}/edit`)
const moveTo = computed(() => `/containers/${route.params.id}/move`)
const canMove = computed(() => {
  const c = data.value?.container
  if (!c || c.doNotMove) return false
  if (!data.value?.currentLocation) return false
  return c.activePoolState === 'AT_LOCATION' || c.activePoolState === 'EXCEPTION'
})

const backTo = computed(() => {
  const locationId = data.value?.currentLocation?.id
  return locationId ? `/locations/${locationId}` : '/containers'
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
    await $fetch(`/api/containers/${route.params.id}`, { method: 'DELETE' })
    confirmOpen.value = false
    await navigateTo(backTo.value)
  }
  catch (err) {
    actionError.value = apiErrorMessage(err, 'Could not delete this container.')
  }
  finally {
    deleting.value = false
  }
}

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
const csxStatus = computed(() => {
  if (liveCheck.value?.status === 'running') return liveCheck.value.stepLabel
  return shipcsxStatusLabel(data.value?.shipcsx)
})
const csxMeta = computed(() => {
  if (liveCheck.value?.status === 'running') return shipcsxCheckProgressLine(liveCheck.value)
  return shipcsxMetaLine(data.value?.shipcsx)
})
const csxProgress = computed(() => {
  const check = liveCheck.value
  if (check?.status !== 'running' || !check.stepCount) return 0
  return Math.round((check.stepIndex / check.stepCount) * 100)
})
const csxNote = computed(() => {
  if (liveCheck.value?.status === 'running') return ''
  if (liveCheck.value?.status === 'error' && liveCheck.value.error) return liveCheck.value.error
  if (csxError.value) return csxError.value
  const raw = data.value?.shipcsx?.error
  return raw ? shipcsxPublicError(raw) : ''
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
          <div class="cd-head-top">
            <span class="eyebrow">Container Record</span>
            <button
              type="button"
              class="icon-btn"
              aria-label="Container actions"
              aria-haspopup="menu"
              :aria-expanded="menuOpen"
              @click="menuOpen = true"
            >
              ⋮
            </button>
          </div>
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
              v-if="data.container.isLoaded && data.container.sealNumber"
              plain
              variant="idle"
              :label="`Seal ${data.container.sealNumber}`"
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
          <NuxtLink
            :to="editTo"
            class="btn-ghost mt-3 w-full"
          >
            Edit information
          </NuxtLink>
        </div>

        <div
          class="csx-block"
          :class="{ running: checkingCsx }"
        >
          <div class="csx-block-head">
            <span class="eyebrow">ShipCSX</span>
            <strong>{{ csxStatus }}</strong>
          </div>
          <div
            v-if="checkingCsx"
            class="csx-progress"
            role="progressbar"
            :aria-valuenow="csxProgress"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="csxMeta"
          >
            <i :style="{ width: `${csxProgress}%` }" />
          </div>
          <p
            v-if="csxMeta"
            class="csx-block-meta"
          >
            {{ csxMeta }}
          </p>
          <p
            v-if="csxNote"
            class="csx-block-note"
            role="status"
          >
            {{ csxNote }}
          </p>
          <NuxtLink
            v-if="!checkingCsx"
            :to="`/containers/${route.params.id}/shipcsx`"
            class="btn-ghost w-full"
          >
            {{ data.shipcsx ? 'Check again' : 'Check CSX' }}
          </NuxtLink>
          <p
            v-else
            class="csx-block-note"
          >
            Checking on ShipCSX…
          </p>
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
          subject="container"
          :entries="timeline"
        />
        <EmptyState
          v-else
          glyph="⇄"
          title="No pickups, drop-offs, or chassis changes yet"
          description="This record lists pickups, drop-offs, and chassis hang or unhang for the current service life."
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

      <BottomSheet
        :open="menuOpen"
        title="Container"
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
        <NuxtLink
          v-if="canMove"
          :to="moveTo"
          class="menu-row"
          role="menuitem"
          @click="closeMenu"
        >
          Move
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
        title="Delete container?"
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
          This container will be removed from the company pool. Trip history stays. This cannot be undone.
        </p>
        <div class="sheet-actions">
          <button
            type="button"
            class="btn-cancel"
            :disabled="deleting"
            @click="confirmOpen = false"
          >
            Keep container
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
