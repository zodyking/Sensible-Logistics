<script setup lang="ts">
import {
  CONTAINER_TYPE_LABELS,
  CONTAINER_TYPES,
  PICKUP_EQUIPMENT_SIZE_LABELS,
  PICKUP_EQUIPMENT_SIZES,
  pickupEquipmentSizeLabel,
} from '#shared/utils/domain'
import type { ContainerType, EquipmentType, LocationType } from '#shared/utils/domain'
import { formatContainerNumber } from '#shared/utils/iso6346'
import { filterLocations } from '#shared/utils/location-search'
import {
  LOCATION_AUDIT_ACTION_HINTS,
  LOCATION_AUDIT_ACTION_LABELS,
  LOCATION_AUDIT_ACTIONS,
  LOCATION_AUDIT_MAX,
  LOCATION_AUDIT_STEPS,
  locationAuditSteps,
  parseBulkContainerNumbers,
} from '#shared/utils/location-audit'
import type { LocationAuditAction, LocationAuditStep } from '#shared/utils/location-audit'

const { user } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')

const route = useRoute()
const locationId = computed(() => String(route.params.id))
const { data: locationData, refresh } = await useFetch(() => `/api/locations/${locationId.value}`)

useHead({ title: () => `Audit · ${locationData.value?.location.name ?? 'Location'}` })

const STEP_TITLES: Record<LocationAuditStep, string> = {
  action: 'Audit',
  numbers: 'Numbers',
  containerType: 'Container type',
  equipmentType: 'Container size',
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

const action = ref<LocationAuditAction | null>(null)
const paste = ref('')
const containerType = ref<ContainerType | null>(null)
const equipmentType = ref<EquipmentType | null>(null)
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

const parsed = computed(() => parseBulkContainerNumbers(paste.value))
const onSite = computed<OnSiteBox[]>(() => (locationData.value?.containers ?? []) as OnSiteBox[])
const onSiteKeys = computed(() => new Set(
  onSite.value.map(item => (item.numberNormalized || item.number).toUpperCase().replace(/[^A-Z0-9]/g, '')),
))
const newNumbers = computed(() => parsed.value.numbers.filter(number => !onSiteKeys.value.has(number)))
const alreadyHere = computed(() => parsed.value.numbers.filter(number => onSiteKeys.value.has(number)))

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
    paste.value = ''
    containerType.value = null
    equipmentType.value = null
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

function pickType(type: ContainerType) {
  containerType.value = type
  void goNext()
}

function pickSize(type: EquipmentType) {
  equipmentType.value = type
  void goNext()
}

function pickDestination(id: string) {
  destinationId.value = id
  void goNext()
}

const canAdvance = computed(() => {
  switch (step.value) {
    case 'action':
      return Boolean(action.value)
    case 'numbers':
      return newNumbers.value.length > 0
    case 'containerType':
      return Boolean(containerType.value)
    case 'equipmentType':
      return Boolean(equipmentType.value)
    case 'pick':
      return pickedBoxes.value.length > 0
    case 'destination':
      return Boolean(destinationId.value)
    case 'confirm':
      if (action.value === 'add') {
        return Boolean(containerType.value && equipmentType.value && newNumbers.value.length)
      }
      if (action.value === 'move') {
        return pickedBoxes.value.length > 0 && Boolean(destinationId.value)
      }
      return pickedBoxes.value.length > 0
  }
  return false
})

const showNext = computed(() => step.value === 'numbers' || step.value === 'pick')

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
  action.value === 'add' ? newNumbers.value.length : pickedBoxes.value.length,
)

const confirmVerb = computed(() => {
  if (action.value === 'add') return confirmCount.value === 1 ? 'Add 1 container' : `Add ${confirmCount.value} containers`
  if (action.value === 'move') return confirmCount.value === 1 ? 'Move 1 container' : `Move ${confirmCount.value} containers`
  return confirmCount.value === 1 ? 'Delete 1 container' : `Delete ${confirmCount.value} containers`
})

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
            containerNumbers: newNumbers.value,
            containerType: containerType.value,
            equipmentType: equipmentType.value,
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
      const who = first?.number ? `${formatContainerNumber(first.number) || first.number}: ` : ''
      errorMessage.value = result.succeeded
        ? `${result.succeeded} saved. ${who}${first?.message || 'The rest could not finish.'}`
        : `${who}${first?.message || 'Nothing was saved.'}`
      if (action.value === 'add') {
        const failed = new Set(result.failed.map(item => (item.number || '').toUpperCase().replace(/[^A-Z0-9]/g, '')))
        paste.value = newNumbers.value.filter(number => failed.has(number)).join('\n')
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
        Built for a fast yard count. One box with a chassis still uses Add Equipment.
      </p>
    </template>

    <template v-else-if="step === 'numbers'">
      <span class="wiz-label">Container numbers</span>
      <label class="field">
        <span class="sr-only">Paste container numbers</span>
        <textarea
          v-model="paste"
          class="textarea mono"
          rows="8"
          :placeholder="'MSCU4521894\nTCLU1234567'"
          autocapitalize="characters"
        />
      </label>
      <p class="wiz-hint">
        Paste or type one per line. Empty boxes only — up to {{ LOCATION_AUDIT_MAX }}.
        <span v-if="newNumbers.length">{{ newNumbers.length }} ready.</span>
        <span v-if="alreadyHere.length">{{ alreadyHere.length }} already on site.</span>
        <span v-if="parsed.invalid.length">{{ parsed.invalid.length }} skipped.</span>
      </p>
    </template>

    <template v-else-if="step === 'containerType'">
      <span class="wiz-label">Container type</span>
      <div class="wiz-group">
        <button
          v-for="type in CONTAINER_TYPES"
          :key="type"
          type="button"
          class="wiz-pick"
          :aria-pressed="containerType === type"
          @click="pickType(type)"
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

    <template v-else-if="step === 'equipmentType'">
      <span class="wiz-label">Container size</span>
      <div class="wiz-group">
        <button
          v-for="type in PICKUP_EQUIPMENT_SIZES"
          :key="type"
          type="button"
          class="wiz-pick"
          :aria-pressed="equipmentType === type"
          @click="pickSize(type)"
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
          <span class="wiz-row-label">Boxes</span>
          <span class="flex-1 text-[var(--color-ink-700)]">{{ confirmCount }}</span>
        </div>
        <div
          v-if="action === 'add'"
          class="wiz-row"
        >
          <span class="wiz-row-label">Kind</span>
          <span class="flex-1 text-[var(--color-ink-700)]">
            {{ containerType ? CONTAINER_TYPE_LABELS[containerType] : '—' }}
            · {{ equipmentType ? pickupEquipmentSizeLabel(equipmentType) : '—' }}
            · Empty
          </span>
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
        v-if="action === 'add' && newNumbers.length"
        class="wiz-group mt-3"
      >
        <div
          v-for="number in newNumbers.slice(0, 8)"
          :key="number"
          class="wiz-row"
        >
          <span class="mono flex-1">{{ formatContainerNumber(number) || number }}</span>
        </div>
        <div
          v-if="newNumbers.length > 8"
          class="wiz-row"
        >
          <span class="flex-1 text-[var(--color-ink-500)]">And {{ newNumbers.length - 8 }} more</span>
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

    <div class="wiz-actions">
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
