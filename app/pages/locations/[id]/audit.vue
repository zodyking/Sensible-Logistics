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

const navTitle = computed(() => {
  if (step.value === 'pick' && action.value === 'check') return 'Checklist'
  if (step.value === 'pick' && action.value === 'move') return 'Move'
  return STEP_TITLES[step.value]
})

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
const scanningId = ref<string | null>(null)
const selectedIds = ref<string[]>([])
const selectedChassisIds = ref<string[]>([])
const holdContainerIds = ref<string[]>([])
const holdChassisIds = ref<string[]>([])
const destinationId = ref<string | null>(null)
const destinationSearch = ref('')
const step = ref<LocationAuditStep>('action')
const submitting = ref(false)
const errorMessage = ref('')

watch(step, scrollWizardToTop)

function blankCard(): EquipmentCard {
  return { ...createAuditEquipmentDraft(), photo: '', ocrMessage: '' }
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
const pickedChassis = computed(() => onSiteChassis.value.filter(item => selectedChassisIds.value.includes(item.id)))
const missingBoxes = computed(() => onSite.value.filter(item => !selectedIds.value.includes(item.id)))
const missingChassis = computed(() => onSiteChassis.value.filter(item => !selectedChassisIds.value.includes(item.id)))
const missingCount = computed(() => missingBoxes.value.length + missingChassis.value.length)
const onSiteCount = computed(() => onSite.value.length + onSiteChassis.value.length)
const allPicked = computed(() => {
  if (action.value === 'check') {
    return onSiteCount.value > 0
      && onSite.value.every(item => selectedIds.value.includes(item.id))
      && onSiteChassis.value.every(item => selectedChassisIds.value.includes(item.id))
  }
  const pool = action.value === 'move' ? movable.value : onSite.value
  return pool.length > 0 && pool.every(item => selectedIds.value.includes(item.id))
})

const auditActions = computed(() =>
  isUncategorizedYard.value
    ? LOCATION_AUDIT_ACTIONS.filter(item => item !== 'check')
    : LOCATION_AUDIT_ACTIONS,
)

const { data: locationList } = await useFetch('/api/locations', {
  query: computed(() => ({
    q: destinationSearch.value || undefined,
    limit: 50,
    lite: '1',
    includeUncategorized: '1',
  })),
})

const { data: holdSites } = await useFetch('/api/locations', {
  query: { includeUncategorized: '1', lite: '1', limit: 100 },
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

const isUncategorizedYard = computed(() => Boolean(locationData.value?.location.isUncategorized))

const holdLocation = computed(() =>
  ((holdSites.value?.items ?? []) as DestLocation[]).find(item => item.isUncategorized) ?? null,
)

const holdFetchId = computed(() => {
  const id = holdLocation.value?.id
  if (!id || id === locationId.value) return ''
  return id
})

const { data: holdData, refresh: refreshHold } = await useAsyncData(
  () => `audit-hold:${holdFetchId.value || 'none'}`,
  async () => {
    if (!holdFetchId.value) return null
    return await $fetch<{
      containers: OnSiteBox[]
      chassis: OnSiteChassis[]
    }>(`/api/locations/${holdFetchId.value}`)
  },
  { watch: [holdFetchId] },
)

const holdBoxes = computed(() => (holdData.value?.containers ?? []).filter(item => !onSiteKeys.value.has(
  `CT:${(item.numberNormalized || item.number).toUpperCase().replace(/[^A-Z0-9]/g, '')}`,
)))
const holdBareChassis = computed(() => (holdData.value?.chassis ?? []).filter(item => !onSiteKeys.value.has(
  `CH:${maskChassisInput(item.number)}`,
)))
const holdSelectedCount = computed(() => holdContainerIds.value.length + holdChassisIds.value.length)
const holdOnlyMove = computed(() =>
  action.value === 'move'
  && holdSelectedCount.value > 0
  && selectedIds.value.length === 0,
)
const pickedHoldBoxes = computed(() => holdBoxes.value.filter(item => holdContainerIds.value.includes(item.id)))
const pickedHoldChassis = computed(() => holdBareChassis.value.filter(item => holdChassisIds.value.includes(item.id)))

const STEPS = computed(() => locationAuditSteps(action.value, { holdOnly: holdOnlyMove.value }))
const stepIndex = computed(() => Math.max(0, STEPS.value.indexOf(step.value)))

watch(STEPS, (steps) => {
  if (steps.includes(step.value)) return
  const from = LOCATION_AUDIT_STEPS.indexOf(step.value)
  const following = LOCATION_AUDIT_STEPS.slice(from + 1).find(name => steps.includes(name))
  const previous = [...LOCATION_AUDIT_STEPS.slice(0, Math.max(0, from))].reverse().find(name => steps.includes(name))
  step.value = following ?? previous ?? 'action'
})

function chooseAction(next: LocationAuditAction) {
  if (action.value !== next) {
    cards.value = [blankCard()]
    scanningId.value = null
    selectedIds.value = []
    selectedChassisIds.value = []
    holdContainerIds.value = []
    holdChassisIds.value = []
    destinationId.value = null
    destinationSearch.value = ''
  }
  action.value = next
  if (next === 'check') {
    selectedIds.value = onSite.value.map(item => item.id)
    selectedChassisIds.value = onSiteChassis.value.map(item => item.id)
  }
  void goNext()
}

function toggleBox(id: string) {
  const box = onSite.value.find(item => item.id === id)
  if (box?.doNotMove && action.value === 'move') return
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter(item => item !== id)
    return
  }
  if (action.value !== 'check' && selectedIds.value.length >= LOCATION_AUDIT_MAX) return
  selectedIds.value = [...selectedIds.value, id]
}

function toggleChassis(id: string) {
  if (selectedChassisIds.value.includes(id)) {
    selectedChassisIds.value = selectedChassisIds.value.filter(item => item !== id)
    return
  }
  selectedChassisIds.value = [...selectedChassisIds.value, id]
}

function toggleAll() {
  if (action.value === 'check') {
    if (allPicked.value) {
      selectedIds.value = []
      selectedChassisIds.value = []
      return
    }
    selectedIds.value = onSite.value.map(item => item.id)
    selectedChassisIds.value = onSiteChassis.value.map(item => item.id)
    return
  }
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

const showNewEquipment = computed(() => {
  const busy = cards.value.some(card => card.stage === 'numbers' || card.stage === 'classify' || card.stage === 'kind')
  return !busy
})

function addEquipment() {
  if (cards.value.length >= LOCATION_AUDIT_MAX || !showNewEquipment.value) return
  cards.value = [...cards.value, blankCard()]
}

function removeCard(id: string) {
  cards.value = cards.value.filter(card => card.id !== id)
  if (!cards.value.length) cards.value = [blankCard()]
}

function toggleHoldContainer(id: string) {
  if (holdContainerIds.value.includes(id)) {
    holdContainerIds.value = holdContainerIds.value.filter(item => item !== id)
    return
  }
  if (holdSelectedCount.value >= LOCATION_AUDIT_MAX) return
  holdContainerIds.value = [...holdContainerIds.value, id]
}

function toggleHoldChassis(id: string) {
  if (holdChassisIds.value.includes(id)) {
    holdChassisIds.value = holdChassisIds.value.filter(item => item !== id)
    return
  }
  if (holdSelectedCount.value >= LOCATION_AUDIT_MAX) return
  holdChassisIds.value = [...holdChassisIds.value, id]
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
  !cards.value.some(card => card.stage === 'numbers' || card.stage === 'classify'),
)
const addCount = computed(() => newItems.value.length)

const canAdvance = computed(() => {
  switch (step.value) {
    case 'action':
      return Boolean(action.value)
    case 'equipment':
      return cardsReady.value && addCount.value > 0 && !scanningId.value
    case 'pick':
      if (action.value === 'check') return onSiteCount.value > 0
      if (action.value === 'move') return pickedBoxes.value.length > 0 || holdSelectedCount.value > 0
      return pickedBoxes.value.length > 0
    case 'destination':
      return Boolean(destinationId.value)
    case 'confirm':
      if (action.value === 'add') return addCount.value > 0
      if (action.value === 'move') {
        if (pickedBoxes.value.length) return Boolean(destinationId.value)
        return holdSelectedCount.value > 0
      }
      if (action.value === 'check') return onSiteCount.value > 0
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

const confirmCount = computed(() => {
  if (action.value === 'add') return addCount.value
  if (action.value === 'check') return missingCount.value
  if (action.value === 'move') return pickedBoxes.value.length + holdSelectedCount.value
  return pickedBoxes.value.length
})

const confirmVerb = computed(() => {
  if (action.value === 'add') {
    const boxes = newItems.value.filter(item => item.kind === 'CONTAINER').length
    const units = newItems.value.filter(item => item.kind === 'BARE_CHASSIS').length
    const parts: string[] = []
    if (boxes) parts.push(boxes === 1 ? '1 container' : `${boxes} containers`)
    if (units) parts.push(units === 1 ? '1 chassis' : `${units} chassis`)
    return parts.length ? `Add ${parts.join(' and ')}` : 'Add equipment'
  }
  if (action.value === 'check') {
    if (!missingCount.value) return 'All present'
    return missingCount.value === 1
      ? 'Move 1 to Uncategorized'
      : `Move ${missingCount.value} to Uncategorized`
  }
  if (action.value === 'move') {
    const sending = pickedBoxes.value.length
    const pulling = holdSelectedCount.value
    if (!sending && pulling) {
      return pulling === 1 ? 'Move 1 onto this yard' : `Move ${pulling} onto this yard`
    }
    if (sending && pulling) {
      return `Move ${sending + pulling} units`
    }
    return sending === 1 ? 'Move 1 container' : `Move ${sending} containers`
  }
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
    if (action.value === 'check' && !missingCount.value) {
      await navigateTo(`/locations/${locationId.value}`)
      return
    }
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
              destinationLocationId: destinationId.value ?? undefined,
              uncategorizedContainerIds: holdContainerIds.value,
              uncategorizedChassisIds: holdChassisIds.value,
            }
          : action.value === 'check'
            ? {
                action: 'check',
                containerIds: missingBoxes.value.map(item => item.id),
                chassisIds: missingChassis.value.map(item => item.id),
              }
            : {
                action: 'delete',
                containerIds: selectedIds.value,
              },
    }))
    await refresh()
    await refreshHold()
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
          if (!item) return card.stage !== 'done'
          const raw = item.kind === 'BARE_CHASSIS' ? item.chassisNumber : item.containerNumber
          return failed.has(markingKey(raw))
        })
        if (!cards.value.length) cards.value = [blankCard()]
        step.value = 'equipment'
      }
      else if (action.value === 'move') {
        const failedIds = new Set(result.failed.map(item => item.id).filter((id): id is string => Boolean(id)))
        selectedIds.value = selectedIds.value.filter(id => failedIds.has(id))
        holdContainerIds.value = holdContainerIds.value.filter(id => failedIds.has(id))
        holdChassisIds.value = holdChassisIds.value.filter(id => failedIds.has(id))
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
      :title="navTitle"
      :back-label="stepIndex > 0 ? 'Back' : (locationData?.location.name ?? 'Location')"
      :back-to="stepIndex > 0 ? undefined : `/locations/${locationId}`"
      @back="back"
    >
      <template
        v-if="step === 'pick' && (action === 'check' ? onSiteCount : onSite.length)"
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
          v-for="item in auditActions"
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
        Built for a fast yard count. Each card asks kind, then numbers, then type.
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
            :can-remove="cards.length > 1 || card.stage !== 'kind'"
            :issue="cardIssue(card, index)"
            :photo="card.photo"
            :ocr-message="card.ocrMessage"
            @update:model-value="patchCard(index, $event)"
            @remove="removeCard(card.id)"
            @photo="onCardPhoto(card.id, $event)"
          />
        </div>
        <button
          v-if="showNewEquipment"
          type="button"
          class="audit-eq-new"
          :disabled="cards.length >= LOCATION_AUDIT_MAX"
          @click="addEquipment"
        >
          + New equipment
        </button>
        <p class="wiz-hint">
          Up to {{ LOCATION_AUDIT_MAX }}.
          <span v-if="addCount">{{ addCount }} ready.</span>
        </p>
      </template>
    </template>

    <template v-else-if="step === 'pick'">
      <template v-if="action !== 'move' || onSite.length">
        <span class="wiz-label">{{
          action === 'check'
            ? 'On this yard'
            : (action === 'delete' ? 'Delete from this yard' : 'Move from this yard')
        }}</span>
        <div
          v-if="action === 'check' ? onSiteCount : onSite.length"
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
              v-else-if="action === 'check'"
              class="audit-eq-add-tag"
            >Out</span>
            <span
              v-else
              class="wiz-chev"
              aria-hidden="true"
            >›</span>
          </button>
          <template v-if="action === 'check'">
            <button
              v-for="item in onSiteChassis"
              :key="item.id"
              type="button"
              class="wiz-pick"
              :aria-pressed="selectedChassisIds.includes(item.id)"
              @click="toggleChassis(item.id)"
            >
              <span class="wiz-pick-main">
                <b class="font-mono">{{ formatChassisNumber(item.number) || item.number }}</b>
                <small>Bare chassis</small>
              </span>
              <span
                v-if="selectedChassisIds.includes(item.id)"
                class="wiz-check"
                aria-hidden="true"
              >✓</span>
              <span
                v-else
                class="audit-eq-add-tag"
              >Out</span>
            </button>
          </template>
        </div>
        <EmptyState
          v-else
          glyph="▣"
          title="No equipment on site"
          description="Drop off from a trip or add equipment here first."
        />
        <p
          v-if="action === 'check' && onSiteCount"
          class="wiz-hint"
        >
          Checked stay. Unchecked move to Uncategorized.
          <span v-if="missingCount">{{ missingCount }} out.</span>
        </p>
      </template>
      <template v-if="action === 'move' && (holdBoxes.length || holdBareChassis.length)">
        <span class="wiz-label">Uncategorized</span>
        <div class="wiz-group">
          <button
            v-for="item in holdBoxes"
            :key="item.id"
            type="button"
            class="wiz-pick"
            :aria-pressed="holdContainerIds.includes(item.id)"
            @click="toggleHoldContainer(item.id)"
          >
            <span class="wiz-pick-main">
              <b class="font-mono">{{ formatContainerNumber(item.number) || item.number }}</b>
              <small>
                {{ CONTAINER_TYPE_LABELS[item.containerType] }}
                · {{ pickupEquipmentSizeLabel(item.equipmentType) }}
                <template v-if="item.isLoaded"> · Loaded</template>
              </small>
            </span>
            <span
              v-if="holdContainerIds.includes(item.id)"
              class="wiz-check"
              aria-hidden="true"
            >✓</span>
            <span
              v-else
              class="audit-eq-add-tag"
            >Move</span>
          </button>
          <button
            v-for="item in holdBareChassis"
            :key="item.id"
            type="button"
            class="wiz-pick"
            :aria-pressed="holdChassisIds.includes(item.id)"
            @click="toggleHoldChassis(item.id)"
          >
            <span class="wiz-pick-main">
              <b class="font-mono">{{ formatChassisNumber(item.number) || item.number }}</b>
              <small>Bare chassis</small>
            </span>
            <span
              v-if="holdChassisIds.includes(item.id)"
              class="wiz-check"
              aria-hidden="true"
            >✓</span>
            <span
              v-else
              class="audit-eq-add-tag"
            >Move</span>
          </button>
        </div>
        <p class="wiz-hint">
          Holding site. Tap to bring onto this yard.
        </p>
      </template>
      <EmptyState
        v-if="action === 'move' && !onSite.length && !holdBoxes.length && !holdBareChassis.length"
        glyph="▣"
        title="No equipment to move"
        description="Nothing on this yard or in Uncategorized."
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
      <span class="wiz-label">{{
        action === 'delete' ? 'Remove' : (action === 'check' ? 'Count' : (action === 'move' ? 'Move' : 'On site'))
      }}</span>
      <div class="wiz-group">
        <div
          v-if="action === 'check'"
          class="wiz-row"
        >
          <span class="wiz-row-label">Stay</span>
          <span class="flex-1 text-[var(--color-ink-700)]">{{ pickedBoxes.length + pickedChassis.length }}</span>
        </div>
        <div class="wiz-row">
          <span class="wiz-row-label">{{ action === 'check' ? 'Out' : 'Units' }}</span>
          <span class="flex-1 text-[var(--color-ink-700)]">{{ action === 'check' ? missingCount : confirmCount }}</span>
        </div>
        <div class="wiz-row">
          <span class="wiz-row-label">{{ action === 'move' ? 'From' : 'Where' }}</span>
          <span class="flex-1 text-[var(--color-ink-700)]">{{
            action === 'move' && holdOnlyMove ? 'Uncategorized' : locationData?.location.name
          }}</span>
        </div>
        <div
          v-if="action === 'move' && pickedBoxes.length"
          class="wiz-row"
        >
          <span class="wiz-row-label">To</span>
          <span class="flex-1 text-[var(--color-ink-700)]">{{ destination?.name ?? '—' }}</span>
        </div>
        <div
          v-else-if="action === 'move' && holdOnlyMove"
          class="wiz-row"
        >
          <span class="wiz-row-label">To</span>
          <span class="flex-1 text-[var(--color-ink-700)]">{{ locationData?.location.name }}</span>
        </div>
        <div
          v-else-if="action === 'check' && missingCount"
          class="wiz-row"
        >
          <span class="wiz-row-label">To</span>
          <span class="flex-1 text-[var(--color-ink-700)]">Uncategorized</span>
        </div>
        <div
          v-if="action === 'move' && pickedBoxes.length && holdSelectedCount"
          class="wiz-row"
        >
          <span class="wiz-row-label">Also</span>
          <span class="flex-1 text-[var(--color-ink-700)]">
            Uncategorized → {{ locationData?.location.name }}
          </span>
        </div>
      </div>
      <div
        v-if="action === 'add' && addCount"
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
          v-if="addCount > 8"
          class="wiz-row"
        >
          <span class="flex-1 text-[var(--color-ink-500)]">And {{ addCount - 8 }} more</span>
        </div>
      </div>
      <div
        v-else-if="action === 'check' && missingCount"
        class="wiz-group mt-3"
      >
        <div
          v-for="item in missingBoxes.slice(0, 8)"
          :key="item.id"
          class="wiz-row"
        >
          <span class="mono flex-1">{{ formatContainerNumber(item.number) || item.number }}</span>
        </div>
        <div
          v-for="item in missingChassis.slice(0, 8)"
          :key="item.id"
          class="wiz-row"
        >
          <span class="mono flex-1">{{ formatChassisNumber(item.number) || item.number }}</span>
        </div>
        <div
          v-if="missingCount > 8"
          class="wiz-row"
        >
          <span class="flex-1 text-[var(--color-ink-500)]">And {{ missingCount - 8 }} more</span>
        </div>
      </div>
      <div
        v-else-if="action === 'move' && confirmCount"
        class="wiz-group mt-3"
      >
        <div
          v-for="item in pickedBoxes.slice(0, 8)"
          :key="item.id"
          class="wiz-row audit-eq-confirm-row"
        >
          <span class="mono">{{ formatContainerNumber(item.number) || item.number }}</span>
          <small
            v-if="destination"
            class="audit-eq-confirm-meta"
          >
            To {{ destination.name }}
          </small>
        </div>
        <div
          v-for="item in pickedHoldBoxes.slice(0, Math.max(0, 8 - pickedBoxes.length))"
          :key="`hold-ct-${item.id}`"
          class="wiz-row audit-eq-confirm-row"
        >
          <span class="mono">{{ formatContainerNumber(item.number) || item.number }}</span>
          <small class="audit-eq-confirm-meta">Uncategorized</small>
        </div>
        <div
          v-for="item in pickedHoldChassis.slice(0, Math.max(0, 8 - pickedBoxes.length - pickedHoldBoxes.length))"
          :key="`hold-ch-${item.id}`"
          class="wiz-row audit-eq-confirm-row"
        >
          <span class="mono">{{ formatChassisNumber(item.number) || item.number }}</span>
          <small class="audit-eq-confirm-meta">Uncategorized · Bare chassis</small>
        </div>
        <div
          v-if="confirmCount > 8"
          class="wiz-row"
        >
          <span class="flex-1 text-[var(--color-ink-500)]">And {{ confirmCount - 8 }} more</span>
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
        <template v-if="isUncategorizedYard">
          Trip history stays. This permanently removes them from the company pool.
        </template>
        <template v-else>
          These will move to Uncategorized. Trip history stays.
        </template>
      </p>
      <p
        v-else-if="action === 'check'"
        class="wiz-hint"
      >
        <template v-if="missingCount">
          Unchecked units move to Uncategorized. Checked stay on this yard.
        </template>
        <template v-else>
          Everything on the list stays here.
        </template>
      </p>
      <p
        v-else-if="action === 'move'"
        class="wiz-hint"
      >
        <template v-if="holdOnlyMove">
          These come from Uncategorized onto this yard.
        </template>
        <template v-else-if="holdSelectedCount">
          On-site boxes go to {{ destination?.name }}. Uncategorized units come onto this yard.
        </template>
        <template v-else>
          Corrections only. A chassis on a box moves with it.
        </template>
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
