<script setup lang="ts">
import {
  CONTAINER_TYPE_LABELS,
  pickupEquipmentSizeLabel,
} from '#shared/utils/domain'
import type { ContainerType, EquipmentType, LocationType } from '#shared/utils/domain'
import {
  formatChassisNumber,
  formatContainerNumber,
  isCompleteChassisNumber,
  maskChassisInput,
  maskContainerInput,
  validateContainerNumber,
} from '#shared/utils/iso6346'
import { filterLocations } from '#shared/utils/location-search'
import {
  LOCATION_AUDIT_ACTION_HINTS,
  LOCATION_AUDIT_ACTION_LABELS,
  LOCATION_AUDIT_ACTIONS,
  LOCATION_AUDIT_MAX,
  LOCATION_AUDIT_STEPS,
  auditAddItemIdentityKey,
  auditEquipmentIdentityKey,
  auditEquipmentItemFromDraft,
  createAuditEquipmentDraft,
  locationAuditSteps,
  readyAuditAddItems,
} from '#shared/utils/location-audit'
import type {
  LocationAuditAction,
  LocationAuditEquipmentDraft,
  LocationAuditEquipmentKind,
  LocationAuditStep,
} from '#shared/utils/location-audit'
import { driverOcrMessage } from '#shared/utils/ocr-parse'
import { PHOTO_READ_MIN_MS, waitAtLeast } from '~/utils/timing'

const { user } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')

const route = useRoute()
const locationId = computed(() => String(route.params.id))
const { data: locationData, refresh } = await useFetch(() => `/api/locations/${locationId.value}`)

useHead({ title: () => `Audit · ${locationData.value?.location.name ?? 'Location'}` })

const STEP_TITLES: Record<LocationAuditStep, string> = {
  action: 'Audit',
  equipment: 'Equipment',
  pick: 'Containers',
  destination: 'Move to',
  confirm: 'Confirm',
}

type OnSiteBox = {
  id: string
  number: string
  numberNormalized?: string | null
  containerType: ContainerType
  equipmentType: EquipmentType
  isLoaded: boolean
  doNotMove?: boolean
}

type OnSiteChassis = {
  id: string
  number: string
}

type EquipmentCard = LocationAuditEquipmentDraft & {
  photo: string
  ocrMessage: string
}

const action = ref<LocationAuditAction | null>(null)
const cards = ref<EquipmentCard[]>([blankCard()])
const pickingKind = ref(false)
const scanningId = ref<string | null>(null)
const selectedIds = ref<string[]>([])
const destinationId = ref<string | null>(null)
const destinationSearch = ref('')
const step = ref<LocationAuditStep>('action')
const submitting = ref(false)
const errorMessage = ref('')

watch(step, scrollWizardToTop)

const STEPS = computed(() => locationAuditSteps(action.value))
const stepIndex = computed(() => Math.max(0, STEPS.value.indexOf(step.value)))

watch(STEPS, (steps) => {
  if (steps.includes(step.value)) return
  const from = LOCATION_AUDIT_STEPS.indexOf(step.value)
  const following = LOCATION_AUDIT_STEPS.slice(from + 1).find(name => steps.includes(name))
  const previous = [...LOCATION_AUDIT_STEPS.slice(0, Math.max(0, from))].reverse().find(name => steps.includes(name))
  step.value = following ?? previous ?? 'action'
})

function blankCard(kind: LocationAuditEquipmentKind = 'CONTAINER'): EquipmentCard {
  return { ...createAuditEquipmentDraft(kind), photo: '', ocrMessage: '' }
}

const onSite = computed<OnSiteBox[]>(() => (locationData.value?.containers ?? []) as OnSiteBox[])
const onSiteChassis = computed<OnSiteChassis[]>(() => (locationData.value?.chassis ?? []) as OnSiteChassis[])
const onSiteKeys = computed(() => {
  const keys = new Set<string>()
  for (const item of onSite.value) {
    const number = (item.numberNormalized || item.number).toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (number) keys.add(`CT:${number}`)
  }
  for (const item of onSiteChassis.value) {
    const number = maskChassisInput(item.number)
    if (number) keys.add(`CH:${number}`)
  }
  return keys
})

const newItems = computed(() =>
  readyAuditAddItems(cards.value).filter(item => !onSiteKeys.value.has(auditAddItemIdentityKey(item))),
)

const movable = computed(() => onSite.value.filter(item => !item.doNotMove))
const pickedBoxes = computed(() => onSite.value.filter(item => selectedIds.value.includes(item.id)))
const allPicked = computed(() => {
  const pool = action.value === 'move' ? movable.value : onSite.value
  return pool.length > 0 && pool.every(item => selectedIds.value.includes(item.id))
})

const { data: locationList } = await useFetch('/api/locations', {
  query: computed(() => ({
    q: destinationSearch.value || undefined,
    limit: 50,
    lite: '1',
    includeUncategorized: '1',
  })),
})

type DestLocation = {
  id: string
  name: string
  type: LocationType
  addressLine1: string | null
  city: string | null
  isUncategorized?: boolean
}

const destinations = computed(() => {
  const items = (locationList.value?.items ?? []) as DestLocation[]
  return filterLocations(items, destinationSearch.value).filter(item => item.id !== locationId.value)
})

const destination = computed(() => destinations.value.find(item => item.id === destinationId.value) ?? null)

function chooseAction(next: LocationAuditAction) {
  if (action.value !== next) {
    cards.value = [blankCard()]
    pickingKind.value = false
    scanningId.value = null
    selectedIds.value = []
    destinationId.value = null
    destinationSearch.value = ''
  }
  action.value = next
  void goNext()
}

function toggleBox(id: string) {
  const box = onSite.value.find(item => item.id === id)
  if (box?.doNotMove && action.value === 'move') return
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter(item => item !== id)
    return
  }
  if (selectedIds.value.length >= LOCATION_AUDIT_MAX) return
  selectedIds.value = [...selectedIds.value, id]
}

function toggleAll() {
  if (action.value === 'move') {
    selectedIds.value = allPicked.value ? [] : movable.value.slice(0, LOCATION_AUDIT_MAX).map(item => item.id)
    return
  }
  const ids = onSite.value.slice(0, LOCATION_AUDIT_MAX).map(item => item.id)
  selectedIds.value = selectedIds.value.length === ids.length ? [] : ids
}

function pickDestination(id: string) {
  destinationId.value = id
  void goNext()
}

function addEquipment(kind: LocationAuditEquipmentKind) {
  if (cards.value.length >= LOCATION_AUDIT_MAX) return
  cards.value = [...cards.value, blankCard(kind)]
  pickingKind.value = false
}

function removeCard(id: string) {
  cards.value = cards.value.filter(card => card.id !== id)
  if (!cards.value.length) pickingKind.value = true
}

function patchCard(index: number, next: LocationAuditEquipmentDraft) {
  const current = cards.value[index]
  if (!current) return
  const copy = [...cards.value]
  copy[index] = {
    ...current,
    ...next,
    photo: current.photo,
    ocrMessage: current.ocrMessage,
  }
  cards.value = copy
}

function cardIssue(card: EquipmentCard, index: number): string {
  const item = auditEquipmentItemFromDraft(card)
  if (!item) {
    if (card.kind === 'BARE_CHASSIS') {
      if (!card.chassisNumber) return ''
      return isCompleteChassisNumber(card.chassisNumber)
        ? ''
        : 'A chassis number is four letters then six digits.'
    }
    const validation = validateContainerNumber(card.containerNumber)
    if (card.containerNumber && card.containerNumber.length >= 11 && !validation.structureValid) {
      return validation.errors[0] || 'Not a container number.'
    }
    if (card.chassisNumber && !isCompleteChassisNumber(card.chassisNumber)) {
      return 'A chassis number is four letters then six digits.'
    }
    if (validation.structureValid && (!card.containerType || !card.equipmentType)) {
      return 'Choose a type and size.'
    }
    return ''
  }
  const key = auditAddItemIdentityKey(item)
  if (onSiteKeys.value.has(key)) return 'Already on site.'
  const first = cards.value.findIndex(other => auditEquipmentIdentityKey(other) === key)
  if (first !== index) return 'Already on another card.'
  return ''
}

const cardsReady = computed(() =>
  cards.value.length > 0
  && cards.value.every((card, index) => Boolean(auditEquipmentItemFromDraft(card)) && !cardIssue(card, index)),
)

const canAdvance = computed(() => {
  switch (step.value) {
    case 'action':
      return Boolean(action.value)
    case 'equipment':
      return cardsReady.value && newItems.value.length > 0 && !scanningId.value
    case 'pick':
      return pickedBoxes.value.length > 0
    case 'destination':
      return Boolean(destinationId.value)
    case 'confirm':
      if (action.value === 'add') return newItems.value.length > 0
      if (action.value === 'move') return pickedBoxes.value.length > 0 && Boolean(destinationId.value)
      return pickedBoxes.value.length > 0
  }
  return false
})

const showNext = computed(() => step.value === 'equipment' || step.value === 'pick')
const scanningLabel = computed(() => (
  cards.value.find(card => card.id === scanningId.value)?.kind === 'BARE_CHASSIS'
    ? 'Reading the chassis number…'
    : 'Reading the photo…'
))

function goNext() {
  errorMessage.value = ''
  const index = stepIndex.value
  if (index < STEPS.value.length - 1) step.value = STEPS.value[index + 1]!
}

function back() {
  errorMessage.value = ''
  const index = stepIndex.value
  if (index > 0) step.value = STEPS.value[index - 1]!
}

function locationAddressLine(location: { addressLine1: string | null, city: string | null }) {
  return [location.addressLine1, location.city].filter(Boolean).join(' · ') || '—'
}

const confirmCount = computed(() =>
  action.value === 'add' ? newItems.value.length : pickedBoxes.value.length,
)

const confirmVerb = computed(() => {
  if (action.value === 'add') {
    const boxes = newItems.value.filter(item => item.kind === 'CONTAINER').length
    const chassis = newItems.value.filter(item => item.kind === 'BARE_CHASSIS').length
    const parts: string[] = []
    if (boxes) parts.push(boxes === 1 ? '1 container' : `${boxes} containers`)
    if (chassis) parts.push(chassis === 1 ? '1 chassis' : `${chassis} chassis`)
    return parts.length ? `Add ${parts.join(' and ')}` : 'Add equipment'
  }
  if (action.value === 'move') return confirmCount.value === 1 ? 'Move 1 container' : `Move ${confirmCount.value} containers`
  return confirmCount.value === 1 ? 'Delete 1 container' : `Delete ${confirmCount.value} containers`
})

function markingKey(value: string | undefined) {
  return (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

async function confirm() {
  if (submitting.value || !canAdvance.value || !action.value) return
  errorMessage.value = ''
  submitting.value = true
  try {
    const { withLoader } = useBrandLoader()
    const result = await withLoader(() => $fetch<{
      succeeded: number
      failed: Array<{ id?: string, number?: string, message: string }>
    }>(`/api/locations/${locationId.value}/audit`, {
      method: 'POST',
      body: action.value === 'add'
        ? {
            action: 'add',
            items: newItems.value,
          }
        : action.value === 'move'
          ? {
              action: 'move',
              containerIds: selectedIds.value,
              destinationLocationId: destinationId.value,
            }
          : {
              action: 'delete',
              containerIds: selectedIds.value,
            },
    }))
    await refresh()
    if (result.failed.length) {
      const first = result.failed[0]
      const who = first?.number ? `${first.number}: ` : ''
      errorMessage.value = result.succeeded
        ? `${result.succeeded} saved. ${who}${first?.message || 'The rest could not finish.'}`
        : `${who}${first?.message || 'Nothing was saved.'}`
      if (action.value === 'add') {
        const failed = new Set(result.failed.map(item => markingKey(item.number)))
        cards.value = cards.value.filter((card) => {
          const item = auditEquipmentItemFromDraft(card)
          if (!item) return true
          const raw = item.kind === 'BARE_CHASSIS' ? item.chassisNumber : item.containerNumber
          return failed.has(markingKey(raw))
        })
        if (!cards.value.length) cards.value = [blankCard()]
        step.value = 'equipment'
      }
      else {
        selectedIds.value = result.failed.map(item => item.id).filter((id): id is string => Boolean(id))
      }
      return
    }
    await navigateTo(`/locations/${locationId.value}`)
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not finish the audit.')
  }
  finally {
    submitting.value = false
  }
}

async function onCardPhoto(cardId: string, dataUrl: string) {
  const index = cards.value.findIndex(card => card.id === cardId)
  const card = cards.value[index]
  if (!card) return
  const copy = [...cards.value]
  copy[index] = { ...card, photo: dataUrl, ocrMessage: '' }
  cards.value = copy
  scanningId.value = cardId
  errorMessage.value = ''
  await nextTick()
  const startedAt = Date.now()
  try {
    const result = await $fetch('/api/scan/recognize', {
      method: 'POST',
      timeout: 180_000,
      headers: { 'Cache-Control': 'no-store' },
      body: { image: dataUrl },
    })
    const latest = cards.value.find(item => item.id === cardId)
    if (!latest) return
    const next = { ...latest, ocrMessage: '' }
    if (latest.kind === 'BARE_CHASSIS') {
      if (result.chassis) next.chassisNumber = maskChassisInput(result.chassis)
      if (!result.chassis) {
        next.ocrMessage = result.message || 'No chassis number could be read. Edit the field or retake.'
      }
    }
    else {
      if (result.container) next.containerNumber = maskContainerInput(result.container)
      if (result.chassis) next.chassisNumber = maskChassisInput(result.chassis)
      if (!result.container) {
        next.ocrMessage = result.message || 'No container number could be read. Edit the field or retake.'
      }
    }
    cards.value = cards.value.map(item => item.id === cardId ? next : item)
  }
  catch (error) {
    const message = driverOcrMessage(
      apiErrorMessage(error, 'Could not read the photo. Edit the field or retake.'),
      'Could not read the photo. Edit the field or retake.',
    )
    cards.value = cards.value.map(item => item.id === cardId ? { ...item, ocrMessage: message } : item)
  }
  finally {
    await waitAtLeast(startedAt, PHOTO_READ_MIN_MS)
    scanningId.value = null
  }
}
</script>

<template>
  <section :class="user?.role === 'ADMIN' ? '' : 'd-page'">
    <WizardNav
      :title="STEP_TITLES[step]"
      :back-label="stepIndex > 0 ? 'Back' : (locationData?.location.name ?? 'Location')"
      :back-to="stepIndex > 0 ? undefined : `/locations/${locationId}`"
      @back="back"
    >
      <template
        v-if="step === 'pick' && onSite.length"
        #end
      >
        <button
          type="button"
          class="wiz-tag"
          @click="toggleAll"
        >
          {{ allPicked ? 'None' : 'All' }}
        </button>
      </template>
    </WizardNav>

    <p
      v-if="errorMessage"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ errorMessage }}</span>
    </p>

    <template v-if="step === 'action'">
      <span class="wiz-label">Audit</span>
      <div class="wiz-group">
        <button
          v-for="item in LOCATION_AUDIT_ACTIONS"
          :key="item"
          type="button"
          class="wiz-pick"
          :aria-pressed="action === item"
          @click="chooseAction(item)"
        >
          <span class="wiz-pick-main">
            <b>{{ LOCATION_AUDIT_ACTION_LABELS[item] }}</b>
            <small>{{ LOCATION_AUDIT_ACTION_HINTS[item] }}</small>
          </span>
          <span
            class="wiz-chev"
            aria-hidden="true"
          >›</span>
        </button>
      </div>
      <p class="wiz-hint">
        Built for a fast yard count. Each card can be a box, a box on a chassis, or a bare chassis.
      </p>
    </template>

    <template v-else-if="step === 'equipment'">
      <ScanReadingLoader
        v-if="scanningId"
        :label="scanningLabel"
      />
      <template v-else>
        <span class="wiz-label">On this yard</span>
        <div class="audit-eq-list">
          <AuditEquipmentCard
            v-for="(card, index) in cards"
            :key="card.id"
            :model-value="card"
            :index="index"
            :can-remove="cards.length > 1"
            :issue="cardIssue(card, index)"
            :photo="card.photo"
            :ocr-message="card.ocrMessage"
            @update:model-value="patchCard(index, $event)"
            @remove="removeCard(card.id)"
            @photo="onCardPhoto(card.id, $event)"
          />
        </div>

        <div
          v-if="pickingKind"
          class="wiz-group mt-4"
        >
          <button
            type="button"
            class="wiz-pick"
            :disabled="cards.length >= LOCATION_AUDIT_MAX"
            @click="addEquipment('CONTAINER')"
          >
            <span class="wiz-pick-ico">
              <EquipmentIcon name="container" />
            </span>
            <span class="wiz-pick-main">
              <b>Container</b>
              <small>Box and chassis</small>
            </span>
            <span
              class="wiz-chev"
              aria-hidden="true"
            >›</span>
          </button>
          <button
            type="button"
            class="wiz-pick"
            :disabled="cards.length >= LOCATION_AUDIT_MAX"
            @click="addEquipment('BARE_CHASSIS')"
          >
            <span class="wiz-pick-ico">
              <EquipmentIcon name="chassis" />
            </span>
            <span class="wiz-pick-main">
              <b>Bare chassis</b>
              <small>Chassis only</small>
            </span>
            <span
              class="wiz-chev"
              aria-hidden="true"
            >›</span>
          </button>
        </div>
        <button
          v-if="pickingKind && cards.length"
          type="button"
          class="wiz-text-btn"
          @click="pickingKind = false"
        >
          Cancel
        </button>
        <button
          v-else-if="!pickingKind"
          type="button"
          class="audit-eq-new"
          :disabled="cards.length >= LOCATION_AUDIT_MAX"
          @click="pickingKind = true"
        >
          New equipment
        </button>
        <p class="wiz-hint">
          Up to {{ LOCATION_AUDIT_MAX }}.
          <span v-if="newItems.length">{{ newItems.length }} ready.</span>
        </p>
      </template>
    </template>

    <template v-else-if="step === 'pick'">
      <span class="wiz-label">{{ action === 'delete' ? 'Delete from this yard' : 'Move from this yard' }}</span>
      <div
        v-if="onSite.length"
        class="wiz-group"
      >
        <button
          v-for="item in onSite"
          :key="item.id"
          type="button"
          class="wiz-pick"
          :aria-pressed="selectedIds.includes(item.id)"
          :disabled="action === 'move' && item.doNotMove"
          @click="toggleBox(item.id)"
        >
          <span class="wiz-pick-main">
            <b class="font-mono">{{ formatContainerNumber(item.number) || item.number }}</b>
            <small>
              {{ CONTAINER_TYPE_LABELS[item.containerType] }}
              · {{ pickupEquipmentSizeLabel(item.equipmentType) }}
              · {{ item.isLoaded ? 'Loaded' : 'Empty' }}
              <template v-if="item.doNotMove"> · Do not move</template>
            </small>
          </span>
          <span
            v-if="selectedIds.includes(item.id)"
            class="wiz-check"
            aria-hidden="true"
          >✓</span>
          <span
            v-else
            class="wiz-chev"
            aria-hidden="true"
          >›</span>
        </button>
      </div>
      <EmptyState
        v-else
        glyph="▣"
        title="No containers on site"
        description="Drop off from a trip or add equipment here first."
      />
    </template>

    <template v-else-if="step === 'destination'">
      <div class="searchbar wiz-search">
        <span aria-hidden="true">⌕</span>
        <input
          v-model="destinationSearch"
          type="search"
          placeholder="Search yards, terminals, customers…"
          aria-label="Search locations"
        >
      </div>
      <LocationGroupedList
        v-if="destinations.length"
        :items="destinations"
      >
        <template #default="{ item: location }">
          <button
            type="button"
            class="wiz-pick"
            :aria-pressed="destinationId === location.id"
            @click="pickDestination(location.id)"
          >
            <span
              class="wiz-pick-ico"
              aria-hidden="true"
            >
              <LocationIcon :name="location.type" />
            </span>
            <span class="wiz-pick-main">
              <b>{{ location.name }}</b>
              <small>{{ locationAddressLine(location) }}</small>
            </span>
            <span
              class="wiz-chev"
              aria-hidden="true"
            >›</span>
          </button>
        </template>
      </LocationGroupedList>
      <EmptyState
        v-else
        glyph="◫"
        :title="destinationSearch.trim() ? 'No locations match' : 'No other locations yet'"
        description="Pick a different yard, terminal, or customer."
      />
    </template>

    <template v-else>
      <span class="wiz-label">{{ action === 'delete' ? 'Remove' : 'On site' }}</span>
      <div class="wiz-group">
        <div class="wiz-row">
          <span class="wiz-row-label">Units</span>
          <span class="flex-1 text-[var(--color-ink-700)]">{{ confirmCount }}</span>
        </div>
        <div class="wiz-row">
          <span class="wiz-row-label">{{ action === 'move' ? 'From' : 'Where' }}</span>
          <span class="flex-1 text-[var(--color-ink-700)]">{{ locationData?.location.name }}</span>
        </div>
        <div
          v-if="action === 'move'"
          class="wiz-row"
        >
          <span class="wiz-row-label">To</span>
          <span class="flex-1 text-[var(--color-ink-700)]">{{ destination?.name ?? '—' }}</span>
        </div>
      </div>
      <div
        v-if="action === 'add' && newItems.length"
        class="wiz-group mt-3"
      >
        <div
          v-for="item in newItems.slice(0, 8)"
          :key="auditAddItemIdentityKey(item)"
          class="wiz-row audit-eq-confirm-row"
        >
          <span
            v-if="item.kind === 'CONTAINER'"
            class="mono"
          >{{ formatContainerNumber(item.containerNumber) || item.containerNumber }}</span>
          <span
            v-else
            class="mono"
          >{{ formatChassisNumber(item.chassisNumber) }}</span>
          <small class="audit-eq-confirm-meta">
            <template v-if="item.kind === 'CONTAINER'">
              {{ CONTAINER_TYPE_LABELS[item.containerType] }}
              · {{ pickupEquipmentSizeLabel(item.equipmentType) }}
              · Empty
              <template v-if="item.chassisNumber">
                · {{ formatChassisNumber(item.chassisNumber) }}
              </template>
            </template>
            <template v-else>
              Bare chassis
            </template>
          </small>
        </div>
        <div
          v-if="newItems.length > 8"
          class="wiz-row"
        >
          <span class="flex-1 text-[var(--color-ink-500)]">And {{ newItems.length - 8 }} more</span>
        </div>
      </div>
      <div
        v-else-if="pickedBoxes.length"
        class="wiz-group mt-3"
      >
        <div
          v-for="item in pickedBoxes.slice(0, 8)"
          :key="item.id"
          class="wiz-row"
        >
          <span class="mono flex-1">{{ formatContainerNumber(item.number) || item.number }}</span>
        </div>
        <div
          v-if="pickedBoxes.length > 8"
          class="wiz-row"
        >
          <span class="flex-1 text-[var(--color-ink-500)]">And {{ pickedBoxes.length - 8 }} more</span>
        </div>
      </div>
      <p
        v-if="action === 'delete'"
        class="wiz-hint"
      >
        Trip history stays. This cannot be undone.
      </p>
      <p
        v-else-if="action === 'move'"
        class="wiz-hint"
      >
        Corrections only. A chassis on a box moves with it.
      </p>
    </template>

    <div
      v-if="!(step === 'equipment' && scanningId)"
      class="wiz-actions"
    >
      <button
        v-if="step === 'confirm'"
        type="button"
        class="wiz-next"
        :disabled="submitting || !canAdvance"
        @click="confirm"
      >
        {{ submitting ? 'Saving…' : confirmVerb }}
      </button>
      <button
        v-else-if="showNext"
        type="button"
        class="wiz-next"
        :disabled="!canAdvance || submitting"
        @click="goNext"
      >
        Next
      </button>
    </div>
  </section>
</template>
