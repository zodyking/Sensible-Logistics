<script setup lang="ts">
import { ACTIVE_POOL_LABELS, CONTAINER_TYPES, CONTAINER_TYPE_LABELS, EQUIPMENT_TYPE_SHORT, PICKUP_EQUIPMENT_SIZES, PICKUP_EQUIPMENT_SIZE_LABELS, TRIP_KIND_LABELS } from '#shared/utils/domain'
import type { ContainerType, EquipmentType, TripKind } from '#shared/utils/domain'
import { PICKUP_STEPS, pickupSteps } from '#shared/utils/pickup-steps'
import type { PickupStep } from '#shared/utils/pickup-steps'
import { mergeSiteContainers } from '#shared/utils/pickup-inventory'
import { filterLocations } from '#shared/utils/location-search'
import {
  formatChassisNumber,
  formatContainerNumber,
  isCompleteChassisNumber,
  maskChassisInput,
  maskContainerInput,
  normalizeContainerNumber,
  validateContainerNumber,
} from '#shared/utils/iso6346'
import { driverOcrMessage } from '#shared/utils/ocr-parse'
import { rememberTripPhoto } from '~/utils/trip-share-files'

useHead({ title: 'New pickup' })

type Step = PickupStep

type YardBox = {
  id: string
  number: string
  numberNormalized?: string | null
  containerType: ContainerType
  equipmentType: EquipmentType
  isLoaded: boolean
  sealNumber?: string | null
  currentChassisId?: string | null
  chassisNumber?: string | null
}

type YardChassis = {
  id: string
  number: string
  provider?: string | null
  sizeCompatibility?: string | null
}

const STEP_TITLES: Record<Step, string> = {
  kind: 'New pickup',
  location: 'Pickup location',
  inventory: 'Which container?',
  equipment: 'Container and chassis',
  containerType: 'Container type',
  equipmentType: 'Container size',
  loadStatus: 'Loaded or empty?',
  seal: 'Seal',
  notes: 'Notes',
  destination: 'Drop-off',
  confirm: 'Confirm',
}

const originLocationId = ref<string | null>(null)
const destinationLocationId = ref<string | null>(null)
const originName = ref('')
const destinationName = ref('')
const originContainers = ref<YardBox[]>([])
const pickupKind = ref<TripKind | null>(null)
const selectedYardId = ref<string | null>(null)
const manualEntry = ref(false)
const rawNumber = ref('')
const containerType = ref<ContainerType | null>(null)
const equipmentType = ref<EquipmentType | null>(null)
const chassisId = ref<string | null>(null)
const chassisNumber = ref('')
const isLoaded = ref<boolean | null>(null)
const sealNumber = ref('')
const notes = ref('')

function resolveNumber(number: string) {
  return $fetch('/api/containers/resolve', { query: { number } })
}

type Resolution = Awaited<ReturnType<typeof resolveNumber>>
const resolution = ref<Resolution | null>(null)

const needsClassification = computed(() => resolution.value?.outcome === 'CREATE')
const fromYard = computed(() => Boolean(selectedYardId.value) && !manualEntry.value)

const route = useRoute()
const swapOfTripId = ref<string | null>(String(route.query.swap || '') || null)
const swapMode = computed(() => Boolean(swapOfTripId.value))

const STEPS = computed<Step[]>(() => pickupSteps({
  kind: pickupKind.value,
  fromYard: fromYard.value,
  manualEntry: manualEntry.value,
  needsClassification: needsClassification.value,
  isLoaded: isLoaded.value,
  swap: swapMode.value,
}))

const step = ref<Step>(swapMode.value ? 'inventory' : 'kind')
watch(step, scrollWizardToTop)
const stepIndex = computed(() => Math.max(0, STEPS.value.indexOf(step.value)))

watch(STEPS, (steps) => {
  if (steps.includes(step.value)) return
  const from = PICKUP_STEPS.indexOf(step.value)
  const following = PICKUP_STEPS.slice(from + 1).find(name => steps.includes(name))
  const previous = [...PICKUP_STEPS.slice(0, Math.max(0, from))].reverse().find(name => steps.includes(name))
  step.value = following ?? previous ?? 'kind'
})

/* --- Data sources ----------------------------------------------- */
const locationSearch = ref('')
const destinationSearch = ref('')
const { data: locationData, status: locationStatus, error: locationError } = await useFetch('/api/locations', {
  key: 'pickup-location-pool',
  query: { limit: 200, lite: '1' },
  server: false,
})

const originOptions = computed(() =>
  filterLocations(locationData.value?.items ?? [], locationSearch.value),
)

const inventory = ref<{
  containers: YardBox[]
  chassis: YardChassis[]
} | null>(null)
const inventoryPending = ref(false)
const inventoryQuery = ref('')

watch(originLocationId, async (id) => {
  if (swapMode.value) return
  selectedYardId.value = null
  manualEntry.value = false
  inventoryQuery.value = ''
  if (destinationLocationId.value && destinationLocationId.value === id) {
    destinationLocationId.value = null
  }
  if (!id) {
    inventory.value = null
    originContainers.value = []
    return
  }
  inventoryPending.value = true
  errorMessage.value = ''
  try {
    const detail = await $fetch(`/api/locations/${id}`)
    originContainers.value = detail.containers ?? []
  }
  catch (error) {
    if (!originContainers.value.length) {
      errorMessage.value = apiErrorMessage(error, 'Could not load equipment at this location.')
    }
  }
  try {
    inventory.value = await $fetch(`/api/locations/${id}/inventory`)
    if (!originContainers.value.length && inventory.value.containers.length) {
      originContainers.value = inventory.value.containers
    }
  }
  catch (error) {
    if (!inventory.value) inventory.value = { containers: [], chassis: [] }
    if (!originContainers.value.length && !errorMessage.value) {
      errorMessage.value = apiErrorMessage(error, 'Could not load equipment at this location.')
    }
  }
  finally {
    inventoryPending.value = false
  }
})

const yardContainers = computed(() => {
  const base = mergeSiteContainers(originContainers.value, inventory.value?.containers ?? [])
  const needle = inventoryQuery.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!needle) return base
  return base.filter(item =>
    (item.numberNormalized || item.number).toUpperCase().replace(/[^A-Z0-9]/g, '').includes(needle),
  )
})

const yardChassis = computed(() => {
  const items = inventory.value?.chassis ?? []
  const needle = inventoryQuery.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!needle) return items
  return items.filter(item =>
    item.number.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(needle)
    || (item.provider ?? '').toUpperCase().includes(inventoryQuery.value.trim().toUpperCase()),
  )
})

watch(pickupKind, (kind) => {
  if (swapMode.value) {
    STEP_TITLES.equipment = 'Load and chassis'
    STEP_TITLES.inventory = 'Which load?'
  }
  else {
    STEP_TITLES.equipment = kind === 'BARE_CHASSIS' ? 'Chassis' : 'Container and chassis'
    STEP_TITLES.inventory = kind === 'BARE_CHASSIS' ? 'Which chassis?' : 'Which container?'
  }
})

rawNumber.value = maskContainerInput(String(route.query.number ?? ''))
if (route.query.chassis) chassisNumber.value = maskChassisInput(String(route.query.chassis))
if (swapMode.value) {
  pickupKind.value = 'CONTAINER'
  isLoaded.value = true
  STEP_TITLES.inventory = 'Which load?'
  STEP_TITLES.equipment = 'Load and chassis'
}

const submitting = ref(false)
const errorMessage = ref('')
const capturedPhoto = ref('')
const readingPhoto = ref(false)
const ocrMessage = ref('')
const { conflict: chassisConflict, releasing: chassisReleasing, promptText: chassisConflictText, decide: decideChassisRelease, releaseIfNeeded } = useChassisReleasePrompt()

/* --- ISO 6346 validation (mirrors the server implementation) ----- */
const normalized = computed(() => normalizeContainerNumber(rawNumber.value))
const validation = computed(() => validateContainerNumber(rawNumber.value))
const showValidation = computed(() => normalized.value.length >= 11)

/* --- Active-pool resolution -------------------------------------- */
const resolving = ref(false)

async function checkPool() {
  if (normalized.value.length < 11) return
  resolving.value = true
  errorMessage.value = ''
  try {
    resolution.value = await resolveNumber(normalized.value)
    const found = resolution.value.container
    if (found?.containerType) containerType.value = found.containerType
    if (found?.equipmentType) equipmentType.value = found.equipmentType
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not check the active pool.')
  }
  finally {
    resolving.value = false
  }
}

watch(normalized, (value) => {
  resolution.value = null
  if (value.length === 11) checkPool()
}, { immediate: true })

const RESOLUTION_COPY: Record<string, { variant: 'ok' | 'warn' | 'err' | 'info', title: string }> = {
  REUSE_ACTIVE: { variant: 'info', title: 'Already in the active pool' },
  REACTIVATE: { variant: 'warn', title: 'Known container — will be reactivated' },
  CREATE: { variant: 'ok', title: 'New container record' },
  CONFLICT: { variant: 'err', title: 'Another driver holds this container' },
}

const blockedByConflict = computed(() => resolution.value?.outcome === 'CONFLICT')

/* --- Field status: a mark on the field, wording only when asked --- */
type FieldState = 'ok' | 'error' | 'idle'

const containerState = computed<FieldState>(() => {
  if (!showValidation.value) return 'idle'
  return validation.value.valid ? 'ok' : 'error'
})

const containerDetail = computed(() => {
  if (!showValidation.value) return ''
  const parts: string[] = []
  if (!validation.value.valid) {
    parts.push(validation.value.errors[0] ?? 'This is not a valid ISO 6346 number.')
    if (validation.value.structureValid && validation.value.expectedCheckDigit !== null) {
      parts.push(`The boxed digit should be ${validation.value.expectedCheckDigit}.`)
    }
  }
  parts.push(...validation.value.warnings)
  return parts.join(' ')
})

const chassisState = computed<FieldState>(() => {
  if (!chassisNumber.value) return 'idle'
  return isCompleteChassisNumber(chassisNumber.value) ? 'ok' : 'error'
})

const chassisDetail = computed(() =>
  chassisState.value === 'error' ? 'A chassis number is four letters then six digits.' : '',
)

/* --- The movement, created once the identifier is confirmed ------ */
const tripId = ref<string | null>(null)
const existingTripId = ref<string | null>(null)
const hydrating = ref(false)
const savedDestinationId = ref<string | null>(null)

async function hydrateFromTrip(id: string) {
  hydrating.value = true
  errorMessage.value = ''
  try {
    const data = await $fetch(`/api/trips/${id}`)
    if (data.trip.status !== 'PICKUP_IN_PROGRESS') {
      errorMessage.value = 'That pickup is no longer in progress.'
      return
    }
    tripId.value = data.trip.id
    originLocationId.value = data.trip.originLocationId
    destinationLocationId.value = data.trip.destinationLocationId
    savedDestinationId.value = data.trip.destinationLocationId
    originName.value = data.origin?.name ?? ''
    destinationName.value = data.destination?.name ?? ''
    pickupKind.value = data.trip.kind === 'BARE_CHASSIS' ? 'BARE_CHASSIS' : 'CONTAINER'
    rawNumber.value = maskContainerInput(data.container?.numberNormalized ?? data.container?.number ?? '')
    if (data.container?.containerType) containerType.value = data.container.containerType
    if (data.container?.equipmentType) equipmentType.value = data.container.equipmentType
    chassisId.value = data.trip.chassisId
    chassisNumber.value = maskChassisInput(data.chassis?.number ?? '')
    isLoaded.value = Boolean(data.trip.swapPairTripId) || Boolean(data.trip.isLoaded)
    if (data.trip.swapPairTripId) {
      swapOfTripId.value = data.trip.swapPairTripId
      pickupKind.value = 'CONTAINER'
      isLoaded.value = true
      STEP_TITLES.inventory = 'Which load?'
      STEP_TITLES.equipment = 'Load and chassis'
    }
    sealNumber.value = data.trip.sealNumber ?? ''
    notes.value = data.trip.driverNotes ?? ''
    manualEntry.value = true
    step.value = data.trip.swapPairTripId
      ? 'confirm'
      : (data.trip.destinationLocationId ? 'confirm' : 'destination')
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not resume that pickup.')
  }
  finally {
    hydrating.value = false
  }
}

async function loadSwapSource(id: string) {
  hydrating.value = true
  inventoryPending.value = true
  errorMessage.value = ''
  try {
    const site = await $fetch(`/api/trips/${id}/swap-site`)
    swapOfTripId.value = id
    pickupKind.value = 'CONTAINER'
    isLoaded.value = true
    originLocationId.value = site.destination.id
    originName.value = site.destination.name ?? ''
    originContainers.value = site.containers ?? []
    inventory.value = {
      containers: site.containers ?? [],
      chassis: site.chassis ?? [],
    }
    step.value = 'inventory'
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not load equipment at the drop-off.')
  }
  finally {
    inventoryPending.value = false
    hydrating.value = false
  }
}

onMounted(async () => {
  const fromQuery = String(route.query.trip ?? '')
  if (fromQuery) {
    await hydrateFromTrip(fromQuery)
    return
  }
  const swapQuery = String(route.query.swap ?? '')
  if (swapQuery) {
    await loadSwapSource(swapQuery)
  }
  try {
    const live = await $fetch('/api/trips', { query: { scope: 'mine', status: 'PICKUP_IN_PROGRESS', limit: 1 } })
    const liveId = live.items[0]?.id as string | undefined
    if (!liveId || liveId === tripId.value) return
    if (swapOfTripId.value) {
      try {
        const open = await $fetch(`/api/trips/${liveId}`)
        if (open.trip.swapPairTripId === swapOfTripId.value) {
          await hydrateFromTrip(liveId)
          return
        }
      }
      catch {
        // Fall through to the resume banner.
      }
    }
    existingTripId.value = liveId
  }
  catch {
    // Listing live trips is a convenience, not a blocker.
  }
})

const claimStep = computed<Step>(() => {
  if (fromYard.value) return 'inventory'
  if (pickupKind.value === 'BARE_CHASSIS') return 'equipment'
  return needsClassification.value ? 'equipmentType' : 'equipment'
})

const chassisOk = computed(() => {
  if (pickupKind.value === 'BARE_CHASSIS') return isCompleteChassisNumber(chassisNumber.value)
  return !chassisNumber.value || isCompleteChassisNumber(chassisNumber.value)
})

type YardContainer = YardBox

async function selectYardContainer(item: YardContainer) {
  manualEntry.value = false
  selectedYardId.value = item.id
  rawNumber.value = maskContainerInput(item.numberNormalized || item.number)
  containerType.value = item.containerType
  equipmentType.value = item.equipmentType
  isLoaded.value = swapMode.value ? true : null
  sealNumber.value = item.sealNumber ?? ''
  chassisId.value = item.currentChassisId ?? null
  chassisNumber.value = item.chassisNumber ? maskChassisInput(item.chassisNumber) : ''
  if (item.currentChassisId && item.chassisNumber && item.sealNumber != null) return
  try {
    const detail = await $fetch<{
      container: { isLoaded: boolean, sealNumber: string | null }
      currentChassis: { id: string, number: string } | null
    }>(`/api/containers/${item.id}`)
    // Don't override — driver will choose on the loadStatus step
    if (detail.container.sealNumber && !sealNumber.value) sealNumber.value = detail.container.sealNumber
    if (detail.currentChassis) {
      chassisId.value = detail.currentChassis.id
      chassisNumber.value = maskChassisInput(detail.currentChassis.number)
    }
  }
  catch {
    // Inventory row is enough to continue; confirm keeps the parked chassis.
  }
}

function selectYardChassis(item: YardChassis) {
  manualEntry.value = false
  selectedYardId.value = item.id
  chassisId.value = item.id
  chassisNumber.value = maskChassisInput(item.number)
}

function enterUnlisted() {
  selectedYardId.value = null
  manualEntry.value = true
  if (pickupKind.value === 'CONTAINER') {
    rawNumber.value = ''
    resolution.value = null
    containerType.value = null
    equipmentType.value = null
    isLoaded.value = swapMode.value ? true : null
  }
  else {
    chassisId.value = null
    chassisNumber.value = ''
  }
  void next()
}

/**
 * A tapped row commits its choice and moves on, the way a native list does.
 * Screens that ask for typing keep the button at the bottom instead.
 */
function chooseKind(kind: TripKind) {
  if (pickupKind.value !== kind && !swapMode.value) {
    containerType.value = null
    equipmentType.value = null
    isLoaded.value = null
    selectedYardId.value = null
    manualEntry.value = false
    inventoryQuery.value = ''
  }
  pickupKind.value = kind
}

function pickOrigin(location: { id: string, name: string, containers?: YardBox[] }) {
  chooseOrigin(location)
}

async function pickYardContainer(item: YardContainer) {
  await selectYardContainer(item)
}

function pickYardChassis(item: YardChassis) {
  selectYardChassis(item)
}

function pickContainerType(type: ContainerType) {
  containerType.value = type
}

function pickEquipmentType(type: EquipmentType) {
  equipmentType.value = type
}

function pickDestination(location: { id: string, name: string }) {
  chooseDestination(location)
}

const showNext = computed(() => {
  if (step.value === 'confirm') return false
  return true
})

function chooseOrigin(location: { id: string, name: string, containers?: YardBox[] }) {
  originLocationId.value = location.id
  originName.value = location.name
  originContainers.value = location.containers ?? []
}

function chooseDestination(location: { id: string, name: string }) {
  destinationLocationId.value = location.id
  destinationName.value = location.name
}

const originLocation = computed(() =>
  locationData.value?.items.find(item => item.id === originLocationId.value) ?? null,
)

const destinationLocation = computed(() =>
  locationData.value?.items.find(item => item.id === destinationLocationId.value) ?? null,
)

const destinationOptions = computed(() =>
  filterLocations(
    (locationData.value?.items ?? []).filter(item => item.id !== originLocationId.value),
    destinationSearch.value,
  ),
)

function locationAddressLine(location: { addressLine1?: string | null, city?: string | null }) {
  return [location.addressLine1, location.city].filter(Boolean).join(' · ') || '—'
}

function chassisCountLabel(count: number | undefined) {
  const n = count ?? 0
  return n === 1 ? '1 chassis' : `${n} chassis`
}

const canAdvance = computed(() => {
  switch (step.value) {
    case 'kind':
      return pickupKind.value === 'CONTAINER' || pickupKind.value === 'BARE_CHASSIS'
    case 'location':
      return Boolean(originLocationId.value)
    case 'inventory':
      return fromYard.value || manualEntry.value
    case 'equipment':
      if (pickupKind.value === 'BARE_CHASSIS') {
        return chassisOk.value && !readingPhoto.value
      }
      return validation.value.structureValid
        && chassisOk.value
        && (swapMode.value || isLoaded.value !== null)
        && !blockedByConflict.value
        && !resolving.value
        && Boolean(resolution.value)
        && !readingPhoto.value
    case 'containerType':
      return Boolean(containerType.value)
    case 'equipmentType':
      return Boolean(equipmentType.value)
    case 'loadStatus':
      return isLoaded.value !== null
    case 'notes':
      return true
    case 'seal':
      return Boolean(sealNumber.value.trim())
    case 'destination':
      return Boolean(destinationLocationId.value) && destinationLocationId.value !== originLocationId.value
    case 'confirm':
      return (swapMode.value || Boolean(destinationLocationId.value))
        && pickupKind.value != null
        && (pickupKind.value !== 'CONTAINER' || (
          Boolean(containerType.value)
          && Boolean(equipmentType.value)
          && (swapMode.value || isLoaded.value !== null)
        ))
  }
  return false
})

function pickupKeepContainerId() {
  if (pickupKind.value !== 'CONTAINER') return null
  if (fromYard.value) return selectedYardId.value
  return resolution.value?.container?.id ?? null
}

async function attachChassis() {
  const typed = chassisNumber.value.trim()
  if (!typed) {
    chassisId.value = null
    return true
  }
  const result = await $fetch('/api/chassis', {
    method: 'POST',
    body: { number: typed },
  })
  const allowed = await releaseIfNeeded(result.item, pickupKeepContainerId())
  if (!allowed) return false
  chassisId.value = result.item.id
  chassisNumber.value = result.item.number
  return true
}

/** Keep the trip row's drop-off current, whether it was picked or inherited. */
async function saveDestination() {
  if (!tripId.value || !destinationLocationId.value) return true
  if (savedDestinationId.value === destinationLocationId.value) return true
  try {
    await $fetch(`/api/trips/${tripId.value}/destination`, {
      method: 'POST',
      body: { destinationLocationId: destinationLocationId.value },
    })
    savedDestinationId.value = destinationLocationId.value
    return true
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not save the drop-off.')
    return false
  }
}

async function next() {
  errorMessage.value = ''

  if (step.value === 'inventory' && !manualEntry.value) {
    try {
      if (!await attachChassis()) return
    }
    catch (error) {
      errorMessage.value = apiErrorMessage(error, 'Could not save the chassis.')
      return
    }
  }

  if (step.value === 'equipment') {
    try {
      if (!await attachChassis()) return
    }
    catch (error) {
      errorMessage.value = apiErrorMessage(error, 'Could not save the chassis.')
      return
    }
  }

  if (step.value === claimStep.value && !tripId.value) {
    await startPickup()
    if (errorMessage.value) return
  }

  if (!await saveDestination()) return

  const index = stepIndex.value
  if (index >= STEPS.value.length - 1) return
  const following = STEPS.value[index + 1]!
  step.value = swapMode.value && following === 'destination' ? 'confirm' : following
}

function back() {
  const index = stepIndex.value
  if (index > 0) step.value = STEPS.value[index - 1]!
}

async function startPickup() {
  if (!pickupKind.value) {
    errorMessage.value = 'Choose container or chassis.'
    return
  }
  if (pickupKind.value === 'BARE_CHASSIS' && !chassisId.value) {
    errorMessage.value = 'Enter a chassis number.'
    return
  }
  if (pickupKind.value === 'CONTAINER' && (!containerType.value || !equipmentType.value)) {
    errorMessage.value = 'Choose container type and size.'
    return
  }
  submitting.value = true
  try {
    const body: Record<string, unknown> = {
      eventId: crypto.randomUUID(),
      kind: pickupKind.value,
      originLocationId: originLocationId.value,
    }
    if (swapOfTripId.value) body.swapOfTripId = swapOfTripId.value
    if (pickupKind.value === 'BARE_CHASSIS') {
      body.chassisId = chassisId.value
    }
    else {
      body.containerNumber = normalized.value
      body.containerType = containerType.value
      body.equipmentType = equipmentType.value
    }

    const result = await $fetch('/api/pickups/start', {
      method: 'POST',
      body,
    })
    tripId.value = result.trip.id
  }
  catch (error) {
    const payload = error as { statusCode?: number, data?: { tripId?: string, data?: { tripId?: string } } }
    const resumeId = payload.data?.tripId ?? payload.data?.data?.tripId
    if (payload.statusCode === 409 && resumeId) {
      existingTripId.value = resumeId
      try {
        const data = await $fetch(`/api/trips/${resumeId}`)
        if (data.trip.status === 'PICKUP_IN_PROGRESS') {
          errorMessage.value = apiErrorMessage(error, 'You already have a pickup in progress.')
          await hydrateFromTrip(resumeId)
          return
        }
        await navigateTo(`/trips/${resumeId}`)
        return
      }
      catch {
        errorMessage.value = apiErrorMessage(error, 'You already have an active movement.')
        return
      }
    }
    errorMessage.value = apiErrorMessage(error, 'Could not start the pickup.')
  }
  finally {
    submitting.value = false
  }
}

async function confirm() {
  if (!tripId.value || submitting.value) return
  if (pickupKind.value === 'CONTAINER' && !swapMode.value && isLoaded.value === null) {
    errorMessage.value = 'Choose empty or load.'
    return
  }
  if (pickupKind.value === 'CONTAINER' && (swapMode.value || isLoaded.value === true) && !sealNumber.value.trim()) {
    errorMessage.value = 'Enter a seal number for a loaded container.'
    step.value = 'seal'
    return
  }
  if (!swapMode.value && !destinationLocationId.value) {
    errorMessage.value = 'Choose a drop-off location.'
    return
  }
  errorMessage.value = ''
  try {
    if (!await attachChassis()) return
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not save the chassis.')
    return
  }
  submitting.value = true

  try {
    await $fetch(`/api/trips/${tripId.value}/confirm`, {
      method: 'POST',
      body: {
        eventId: crypto.randomUUID(),
        chassisId: chassisId.value,
        destinationLocationId: destinationLocationId.value,
        isLoaded: pickupKind.value === 'CONTAINER' ? (swapMode.value || isLoaded.value === true) : false,
        sealNumber: pickupKind.value === 'CONTAINER' && (swapMode.value || isLoaded.value === true) ? (sealNumber.value.trim() || null) : null,
        notes: notes.value || null,
      },
    })
    if (capturedPhoto.value) {
      await rememberTripPhoto(tripId.value, capturedPhoto.value, {
        containerNumber: pickupKind.value === 'CONTAINER' ? normalized.value : null,
        chassisNumber: chassisNumber.value,
      })
    }
    await navigateTo('/')
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not confirm the pickup.')
  }
  finally {
    submitting.value = false
  }
}

async function abandon() {
  if (!tripId.value) {
    await navigateTo('/')
    return
  }

  try {
    await $fetch(`/api/trips/${tripId.value}/cancel`, {
      method: 'POST',
      body: { eventId: crypto.randomUUID(), reason: swapMode.value ? 'Driver cancelled the swap pickup.' : 'Driver cancelled before confirming.' },
    })
  }
  finally {
    await navigateTo('/')
  }
}

watch([tripId, capturedPhoto, normalized, chassisNumber], ([id, photo]) => {
  if (id && photo) {
    void rememberTripPhoto(id, photo, {
      containerNumber: pickupKind.value === 'CONTAINER' ? normalized.value : null,
      chassisNumber: chassisNumber.value,
    })
  }
})

async function onPhoto(dataUrl: string) {
  capturedPhoto.value = dataUrl
  readingPhoto.value = true
  ocrMessage.value = ''
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
    if (result.container && pickupKind.value === 'CONTAINER') {
      rawNumber.value = maskContainerInput(result.container)
    }
    if (result.chassis) chassisNumber.value = maskChassisInput(result.chassis)
    if (pickupKind.value === 'BARE_CHASSIS') {
      if (!result.chassis) {
        ocrMessage.value = result.message || 'No chassis number could be read. Edit the field or retake.'
      }
    }
    else if (!result.container) {
      ocrMessage.value = result.message || 'No container number could be read. Edit the fields or retake.'
    }
  }
  catch (error) {
    ocrMessage.value = driverOcrMessage(
      apiErrorMessage(error, 'Could not read the photo. Edit the fields or retake.'),
      'Could not read the photo. Edit the fields or retake.',
    )
  }
  finally {
    await waitAtLeast(startedAt, PHOTO_READ_MIN_MS)
    readingPhoto.value = false
  }
}
</script>

<template>
  <section class="d-page">
    <WizardNav
      :title="STEP_TITLES[step]"
      :back-label="stepIndex > 0 ? 'Back' : 'Home'"
      :back-to="stepIndex > 0 ? undefined : '/'"
      @back="back"
    >
      <template
        v-if="swapMode"
        #end
      >
        <span class="wiz-tag">Swap</span>
      </template>
    </WizardNav>

    <p
      v-if="hydrating"
      class="wiz-hint"
      role="status"
    >
      Resuming your pickup…
    </p>

    <p
      v-if="errorMessage"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ errorMessage }}</span>
    </p>

    <p
      v-if="existingTripId && !tripId && !swapMode"
      class="note"
      role="status"
    >
      <span>
        You already have a pickup in progress.
        <button
          type="button"
          class="font-semibold underline"
          @click="hydrateFromTrip(existingTripId)"
        >
          Continue it
        </button>
        instead of starting another.
      </span>
    </p>

    <!-- ── What are you picking up? ────────────────────────────── -->
    <template v-if="step === 'kind'">
      <span class="wiz-label">Create a new pickup</span>
      <div class="wiz-group">
        <button
          type="button"
          class="wiz-pick"
          :aria-pressed="pickupKind === 'CONTAINER'"
          @click="chooseKind('CONTAINER')"
        >
          <span class="wiz-pick-ico">
            <EquipmentIcon name="container" />
          </span>
          <span class="wiz-pick-main">
            <b>{{ TRIP_KIND_LABELS.CONTAINER }}</b>
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
          :aria-pressed="pickupKind === 'BARE_CHASSIS'"
          @click="chooseKind('BARE_CHASSIS')"
        >
          <span class="wiz-pick-ico">
            <EquipmentIcon name="chassis" />
          </span>
          <span class="wiz-pick-main">
            <b>{{ TRIP_KIND_LABELS.BARE_CHASSIS }}</b>
            <small>Chassis only — hang a container later</small>
          </span>
          <span
            class="wiz-chev"
            aria-hidden="true"
          >›</span>
        </button>
      </div>
    </template>

    <!-- ── Location ────────────────────────────────────────────── -->
    <template v-else-if="step === 'location'">
      <div class="searchbar wiz-search">
        <span aria-hidden="true">⌕</span>
        <input
          v-model="locationSearch"
          type="search"
          placeholder="Search yards, terminals, customers…"
          aria-label="Search locations"
        >
      </div>

      <p
        v-if="locationStatus === 'pending'"
        class="wiz-hint"
        role="status"
      >
        Loading locations…
      </p>

      <p
        v-else-if="locationError"
        class="banner err"
        role="alert"
      >
        Could not load locations. Go back and try again, or add sites from More → Customers & locations.
      </p>

      <template v-else-if="originOptions.length">
        <LocationGroupedList :items="originOptions">
          <template #default="{ item: location }">
            <button
              type="button"
              class="wiz-pick"
              :aria-pressed="originLocationId === location.id"
              @click="pickOrigin(location)"
            >
              <span
                class="wiz-pick-ico"
                aria-hidden="true"
              >
                <LocationIcon :name="location.type" />
              </span>
              <span class="wiz-pick-main">
                <b>{{ location.name }}</b>
                <small>
                  {{ locationAddressLine(location) }}
                  <template v-if="pickupKind === 'BARE_CHASSIS'">
                    · {{ chassisCountLabel(location.availableChassis) }}
                  </template>
                </small>
              </span>
              <span
                v-if="originLocationId === location.id"
                class="wiz-check"
                aria-hidden="true"
              >✓</span>
              <span
                v-else
                class="wiz-chev"
                aria-hidden="true"
              >›</span>
            </button>
          </template>
        </LocationGroupedList>
      </template>

      <EmptyState
        v-else
        glyph="◫"
        :title="locationSearch.trim() ? 'No locations match' : 'No locations yet'"
        description="Pick an existing yard, terminal, or customer. Add new ones from More → Customers & locations."
      />
    </template>

    <!-- ── Yard inventory ──────────────────────────────────────── -->
    <template v-else-if="step === 'inventory'">
      <div class="searchbar wiz-search">
        <span aria-hidden="true">⌕</span>
        <input
          v-model="inventoryQuery"
          type="search"
          :placeholder="pickupKind === 'BARE_CHASSIS' ? 'Search chassis…' : 'Search containers…'"
          :aria-label="pickupKind === 'BARE_CHASSIS' ? 'Search chassis' : 'Search containers'"
        >
      </div>

      <p
        v-if="inventoryPending && !yardContainers.length && !yardChassis.length"
        class="wiz-hint"
        role="status"
      >
        Loading what’s on site…
      </p>

      <template v-if="pickupKind === 'CONTAINER' && yardContainers.length">
        <span class="wiz-label">{{ swapMode ? (originName ? `On site at ${originName}` : 'On site at drop-off') : 'On site now' }}</span>
        <div class="wiz-group">
          <button
            v-for="item in yardContainers"
            :key="item.id"
            type="button"
            class="wiz-pick"
            :aria-pressed="selectedYardId === item.id"
            @click="pickYardContainer(item)"
          >
            <span class="wiz-pick-ico">
              <EquipmentIcon
                name="container"
                :size="34"
              />
            </span>
            <span class="wiz-pick-main">
              <b>{{ formatContainerNumber(item.numberNormalized || item.number) }}</b>
              <small>
                {{ CONTAINER_TYPE_LABELS[item.containerType] }}
                · {{ EQUIPMENT_TYPE_SHORT[item.equipmentType] }}
                · {{ item.isLoaded ? 'Loaded' : 'Empty' }}
                <template v-if="item.chassisNumber"> · {{ formatChassisNumber(item.chassisNumber) }}</template>
              </small>
            </span>
            <span
              v-if="selectedYardId === item.id"
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
      </template>

      <template v-else-if="pickupKind === 'BARE_CHASSIS' && yardChassis.length">
        <span class="wiz-label">On site now</span>
        <div class="wiz-group">
          <button
            v-for="item in yardChassis"
            :key="item.id"
            type="button"
            class="wiz-pick"
            :aria-pressed="selectedYardId === item.id"
            @click="pickYardChassis(item)"
          >
            <span class="wiz-pick-ico">
              <EquipmentIcon
                name="chassis"
                :size="34"
              />
            </span>
            <span class="wiz-pick-main">
              <b>{{ formatChassisNumber(item.number) }}</b>
              <small>{{ [item.provider, item.sizeCompatibility].filter(Boolean).join(' · ') || 'Available' }}</small>
            </span>
            <span
              v-if="selectedYardId === item.id"
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
      </template>

      <EmptyState
        v-else-if="!inventoryPending"
        glyph="▦"
        :title="pickupKind === 'BARE_CHASSIS' ? 'No chassis on site' : 'No containers on site'"
        :description="inventoryQuery.trim()
          ? 'Nothing matching that search is parked here.'
          : 'Add it below if it is not on the list yet.'"
      />

      <span class="wiz-label">Not on the list</span>
      <div class="wiz-group">
        <button
          type="button"
          class="wiz-pick"
          @click="enterUnlisted"
        >
          <span class="wiz-pick-ico">
            <EquipmentIcon
              :name="pickupKind === 'BARE_CHASSIS' ? 'chassis' : 'container'"
              :size="34"
            />
          </span>
          <span class="wiz-pick-main">
            <b>{{ pickupKind === 'BARE_CHASSIS' ? 'Add a chassis' : 'Add a container' }}</b>
            <small>Scan or type the number</small>
          </span>
          <span
            class="wiz-chev"
            aria-hidden="true"
          >›</span>
        </button>
      </div>
    </template>

    <!-- ── Container + chassis (one photo) ──────────────────────── -->
    <template v-else-if="step === 'equipment'">
      <ScanReadingLoader
        v-if="readingPhoto"
        :label="pickupKind === 'BARE_CHASSIS' ? 'Reading the chassis number…' : 'Reading the photo…'"
      />
      <template v-else>
        <ScanPhotoPeek
          v-if="capturedPhoto"
          :src="capturedPhoto"
        />

        <div class="wiz-hero">
          <span class="wiz-hero-badge">
            <EquipmentIcon
              :name="pickupKind === 'BARE_CHASSIS' ? 'chassis' : 'container'"
              :size="60"
            />
          </span>
          <b>{{ pickupKind ? TRIP_KIND_LABELS[pickupKind] : '' }}</b>
        </div>

        <template v-if="pickupKind === 'CONTAINER'">
          <span class="wiz-label">Container info</span>
          <div class="wiz-group">
            <div class="wiz-row">
              <label
                class="wiz-row-label"
                for="container-number"
              >Number</label>
              <ContainerNumberInput
                id="container-number"
                v-model="rawNumber"
                :disabled="Boolean(tripId)"
                :invalid="containerState === 'error'"
              />
              <FieldStatus
                :state="containerState"
                :detail="containerDetail || 'Four letters, six digits, then the boxed check digit.'"
                label="container number"
              />
            </div>
          </div>

          <template v-if="!swapMode">
            <span class="wiz-label">Container status</span>
            <div class="wiz-group">
              <div class="wiz-status">
                <button
                  type="button"
                  class="wiz-status-btn"
                  :aria-pressed="isLoaded === false"
                  @click="isLoaded = false"
                >
                  <span
                    class="wiz-status-mark"
                    aria-hidden="true"
                  >E</span>
                  <span class="wiz-status-name">Empty</span>
                </button>
                <button
                  type="button"
                  class="wiz-status-btn"
                  :aria-pressed="isLoaded === true"
                  @click="isLoaded = true"
                >
                  <span
                    class="wiz-status-mark"
                    aria-hidden="true"
                  >L</span>
                  <span class="wiz-status-name">Load</span>
                </button>
              </div>
            </div>
          </template>
        </template>

        <span class="wiz-label">Chassis info</span>
        <div class="wiz-group">
          <div class="wiz-row">
            <label
              class="wiz-row-label"
              for="chassis-number"
            >Number</label>
            <ChassisNumberInput
              id="chassis-number"
              v-model="chassisNumber"
              :invalid="chassisState === 'error'"
            />
            <FieldStatus
              :state="chassisState"
              :detail="chassisDetail || 'Four letters and six digits.'"
              label="chassis number"
            />
          </div>
        </div>
        <p
          v-if="pickupKind === 'CONTAINER'"
          class="wiz-hint"
        >
          Leave the chassis blank if you are not taking one.
        </p>

        <div aria-live="polite">
          <p
            v-if="ocrMessage && !readingPhoto"
            class="note warn"
          >
            <span>{{ ocrMessage }}</span>
          </p>

          <p
            v-if="pickupKind === 'CONTAINER' && resolving"
            class="note"
          >
            <span>Checking the active container pool…</span>
          </p>
          <p
            v-else-if="pickupKind === 'CONTAINER' && resolution"
            class="note"
            :class="RESOLUTION_COPY[resolution.outcome]?.variant"
          >
            <span>
              <b>{{ RESOLUTION_COPY[resolution.outcome]?.title }}.</b>
              {{ resolution.message }}
            </span>
          </p>
        </div>

        <div
          v-if="pickupKind === 'CONTAINER' && resolution?.outcome === 'CONFLICT' && resolution.holder"
          class="card mt-4 p-4"
        >
          <span class="eyebrow">Current holder</span>
          <div class="trip-facts mt-3 !border-t-0 !pt-0">
            <div class="trip-fact">
              <small>Driver</small>
              <b>{{ resolution.holder.driverName }}</b>
            </div>
            <div class="trip-fact">
              <small>State</small>
              <b>{{ ACTIVE_POOL_LABELS[resolution.holder.activePoolState as keyof typeof ACTIVE_POOL_LABELS] }}</b>
            </div>
            <div class="trip-fact">
              <small>Believed at</small>
              <b>{{ resolution.holder.believedLocationName ?? 'In transit' }}</b>
            </div>
          </div>
          <p class="mt-4 text-sm text-[var(--color-ink-500)]">
            A second pickup cannot be started for this container. Contact dispatch or an administrator to
            resolve the conflict.
          </p>
        </div>

        <DevicePhotoInput
          v-if="!tripId"
          class="btn-ghost mt-5 w-full"
          :label="capturedPhoto ? 'Retake photo' : 'Scan with the camera'"
          :disabled="readingPhoto"
          @photo="onPhoto"
        />
      </template>
    </template>

    <!-- ── Container type (new records only) ───────────────────── -->
    <template v-else-if="step === 'containerType'">
      <span class="wiz-label">Container type</span>
      <div class="wiz-group">
        <button
          v-for="type in CONTAINER_TYPES"
          :key="type"
          type="button"
          class="wiz-pick"
          :aria-pressed="containerType === type"
          :disabled="Boolean(tripId)"
          @click="pickContainerType(type)"
        >
          <span class="wiz-pick-main">
            <b>{{ CONTAINER_TYPE_LABELS[type] }}</b>
          </span>
          <span
            v-if="containerType === type"
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
    </template>

    <!-- ── Equipment type (new records only) ───────────────────── -->
    <template v-else-if="step === 'equipmentType'">
      <span class="wiz-label">Container size</span>
      <div class="wiz-group">
        <button
          v-for="type in PICKUP_EQUIPMENT_SIZES"
          :key="type"
          type="button"
          class="wiz-pick"
          :aria-pressed="equipmentType === type"
          :disabled="Boolean(tripId)"
          @click="pickEquipmentType(type)"
        >
          <span class="wiz-pick-main">
            <b>{{ PICKUP_EQUIPMENT_SIZE_LABELS[type] }}</b>
          </span>
          <span
            v-if="equipmentType === type"
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
    </template>

    <!-- ── Loaded or empty (yard-picked containers) ─────────── -->
    <template v-else-if="step === 'loadStatus'">
      <span class="wiz-label">Is this container loaded or empty?</span>
      <div class="wiz-group">
        <div class="wiz-status">
          <button
            type="button"
            class="wiz-status-btn"
            :aria-pressed="isLoaded === false"
            @click="isLoaded = false"
          >
            <span
              class="wiz-status-mark"
              aria-hidden="true"
            >E</span>
            <span class="wiz-status-name">Empty</span>
          </button>
          <button
            type="button"
            class="wiz-status-btn"
            :aria-pressed="isLoaded === true"
            @click="isLoaded = true"
          >
            <span
              class="wiz-status-mark"
              aria-hidden="true"
            >L</span>
            <span class="wiz-status-name">Load</span>
          </button>
        </div>
      </div>
      <p class="wiz-hint">
        Choose empty if the container has no cargo. Choose load if it is carrying freight.
      </p>
    </template>

    <!-- ── Seal ────────────────────────────────────────────────── -->
    <template v-else-if="step === 'seal'">
      <span class="wiz-label">Seal</span>
      <div class="wiz-group">
        <div class="wiz-row">
          <label
            class="wiz-row-label"
            for="seal-number"
          >Number</label>
          <input
            id="seal-number"
            v-model="sealNumber"
            class="input mono"
            placeholder="required"
            autocapitalize="characters"
            autocomplete="off"
            required
          >
        </div>
      </div>
      <p class="wiz-hint">
        A loaded container carries its seal on the trip.
      </p>
    </template>

    <!-- ── Notes ───────────────────────────────────────────────── -->
    <template v-else-if="step === 'notes'">
      <span class="wiz-label">Notes</span>
      <div class="wiz-group">
        <div class="wiz-row wiz-row-stack">
          <textarea
            v-model="notes"
            class="textarea"
            placeholder="optional — damage, exceptions, gate instructions…"
            aria-label="Notes"
          />
        </div>
      </div>
    </template>

    <!-- ── Destination (plain pickup only — swap never picks a location) ── -->
    <template v-else-if="step === 'destination' && !swapMode">
      <div class="searchbar wiz-search">
        <span aria-hidden="true">⌕</span>
        <input
          v-model="destinationSearch"
          type="search"
          placeholder="Search yards, terminals, customers…"
          aria-label="Search drop-off locations"
        >
      </div>

      <p
        v-if="locationStatus === 'pending'"
        class="wiz-hint"
        role="status"
      >
        Loading locations…
      </p>

      <p
        v-else-if="locationError"
        class="banner err"
        role="alert"
      >
        Could not load locations. Go back and try again, or add sites from More → Customers & locations.
      </p>

      <template v-else-if="destinationOptions.length">
        <LocationGroupedList :items="destinationOptions">
          <template #default="{ item: location }">
            <button
              type="button"
              class="wiz-pick"
              :aria-pressed="destinationLocationId === location.id"
              @click="pickDestination(location)"
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
                v-if="destinationLocationId === location.id"
                class="wiz-check"
                aria-hidden="true"
              >✓</span>
              <span
                v-else
                class="wiz-chev"
                aria-hidden="true"
              >›</span>
            </button>
          </template>
        </LocationGroupedList>
      </template>

      <EmptyState
        v-else
        glyph="◫"
        :title="destinationSearch.trim() ? 'No drop-off matches' : 'No other locations yet'"
        description="Pick a different yard, terminal, or customer than the pickup. Add new ones from More → Customers & locations."
      />
    </template>

    <!-- ── Confirm ─────────────────────────────────────────────── -->
    <template v-else-if="step === 'confirm'">
      <TripCard
        :trip-kind="pickupKind"
        :container-type="pickupKind === 'CONTAINER' ? containerType : null"
        :is-loaded="pickupKind === 'CONTAINER' ? isLoaded : false"
        :container-number="pickupKind === 'CONTAINER' ? formatContainerNumber(normalized) : ''"
        :equipment-type="pickupKind === 'CONTAINER' ? equipmentType : null"
        :chassis-number="chassisNumber ? formatChassisNumber(chassisNumber) : undefined"
        :seal-number="pickupKind === 'CONTAINER' ? sealNumber : ''"
        :origin-name="originLocation?.name || originName"
        :destination-name="destinationLocation?.name || destinationName"
        origin-label="Pickup"
      />

      <p class="wiz-hint">
        {{
          swapMode
            ? 'Confirming records the load pickup. The empty stays on Home until you arrive at this customer.'
            : pickupKind === 'BARE_CHASSIS'
              ? 'Confirming records the chassis pickup and departure.'
              : 'Confirming records the pickup and puts the container in transit.'
        }}
      </p>
    </template>

    <!-- ── Actions ─────────────────────────────────────────────── -->
    <div
      v-if="!(step === 'equipment' && readingPhoto)"
      class="wiz-actions"
    >
      <button
        v-if="step === 'confirm'"
        type="button"
        class="wiz-next"
        :disabled="submitting || !canAdvance"
        @click="confirm"
      >
        {{ submitting ? 'Confirming…' : 'Confirm pickup' }}
      </button>

      <button
        v-else-if="showNext"
        type="button"
        class="wiz-next"
        :disabled="!canAdvance || submitting"
        @click="next"
      >
        {{ submitting ? 'Working…' : 'Continue' }}
      </button>

      <button
        type="button"
        class="wiz-text-btn danger"
        @click="abandon"
      >
        {{ tripId ? (swapMode ? 'Cancel swap pickup' : 'Cancel this pickup') : 'Discard and go home' }}
      </button>
    </div>

    <ChassisReleaseSheet
      :open="Boolean(chassisConflict)"
      :message="chassisConflictText"
      :busy="chassisReleasing"
      @close="decideChassisRelease(false)"
      @confirm="decideChassisRelease(true)"
    />
  </section>
</template>
