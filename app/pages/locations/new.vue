<script setup lang="ts">
import { LOCATION_GLYPH, LOCATION_TYPE_LABELS, LOCATION_TYPES } from '#shared/utils/domain'
import type { LocationType } from '#shared/utils/domain'
import { bboxAround, polygonFromBbox, type BoundingBox } from '#shared/utils/geo'
import { generateYardModel } from '#shared/utils/yard-model'

const { user } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')

useHead({ title: 'Add location' })

const route = useRoute()
const returnTo = computed(() => {
  const raw = String(route.query.returnTo ?? '')
  return raw.startsWith('/') ? raw : '/locations'
})

const DEFAULT_CAPACITY: Record<LocationType, number> = {
  MARINE_TERMINAL: 240,
  RAIL_TERMINAL: 80,
  CUSTOMER: 6,
  WAREHOUSE: 40,
  COMPANY_YARD: 48,
  DEPOT: 80,
  REPAIR_SHOP: 8,
  STAGING: 20,
  TEMPORARY: 12,
}

type Step = 'type' | 'name' | 'address' | 'map'
const STEPS: Step[] = ['type', 'name', 'address', 'map']
const STEP_TITLES: Record<Step, string> = {
  type: 'What kind of location?',
  name: 'What do you call it?',
  address: 'Where is it?',
  map: 'Fence the yard',
}

type PlaceHit = {
  displayName: string
  latitude: number
  longitude: number
  addressLine1: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  bbox: BoundingBox | null
}

const step = ref<Step>('type')
const stepIndex = computed(() => STEPS.indexOf(step.value))

const form = reactive({
  type: 'CUSTOMER' as LocationType,
  name: '',
  addressQuery: '',
  addressLine1: '',
  city: '',
  state: '',
  postalCode: '',
  capacity: DEFAULT_CAPACITY.CUSTOMER,
})

const latitude = ref<number | null>(null)
const longitude = ref<number | null>(null)
const bbox = ref<BoundingBox | null>(null)

watch(() => form.type, (type, previous) => {
  if (form.capacity === DEFAULT_CAPACITY[previous]) {
    form.capacity = DEFAULT_CAPACITY[type]
  }
})

const suggestions = ref<PlaceHit[]>([])
const searching = ref(false)
const suggestError = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined

watch(() => form.addressQuery, (value) => {
  clearTimeout(searchTimer)
  if (value.trim().length < 3) {
    suggestions.value = []
    return
  }
  searchTimer = setTimeout(() => lookupAddress(value.trim()), 350)
})

onBeforeUnmount(() => clearTimeout(searchTimer))

async function lookupAddress(q: string) {
  searching.value = true
  suggestError.value = ''
  try {
    const result = await $fetch('/api/geocode/search', { query: { q, limit: 6 } })
    suggestions.value = result.results
    if (!result.available && result.message) suggestError.value = result.message
  }
  catch (error) {
    suggestError.value = apiErrorMessage(error, 'Address search failed.')
  }
  finally {
    searching.value = false
  }
}

function applySuggestion(hit: PlaceHit) {
  form.addressLine1 = hit.addressLine1 || hit.displayName
  form.city = hit.city ?? ''
  form.state = hit.state ?? ''
  form.postalCode = hit.postalCode ?? ''
  form.addressQuery = hit.displayName
  latitude.value = hit.latitude
  longitude.value = hit.longitude
  bbox.value = hit.bbox ?? bboxAround(hit.latitude, hit.longitude, 160)
  suggestions.value = []
  step.value = 'map'
}

const model = computed(() => {
  if (!bbox.value) return null
  return generateYardModel(bbox.value, Number(form.capacity) || 0)
})

const canAdvance = computed(() => {
  switch (step.value) {
    case 'type': return Boolean(form.type)
    case 'name': return form.name.trim().length >= 2
    case 'address': return Boolean(latitude.value && longitude.value && form.addressLine1)
    case 'map': return Boolean(bbox.value && form.capacity >= 0)
  }
  return false
})

function next() {
  if (step.value === 'address' && !latitude.value) {
    lookupAddress(form.addressQuery.trim())
    return
  }
  const index = stepIndex.value
  if (index < STEPS.length - 1) step.value = STEPS[index + 1]!
}

function back() {
  const index = stepIndex.value
  if (index > 0) step.value = STEPS[index - 1]!
}

const submitting = ref(false)
const errorMessage = ref('')
type DuplicateSuggestion = {
  id: string
  name: string
  reason: 'SAME_ADDRESS' | 'SIMILAR_NAME' | 'NEARBY'
  distanceMeters: number | null
}
const duplicates = ref<DuplicateSuggestion[]>([])
const acknowledgeDuplicates = ref(false)

const DUPLICATE_REASONS: Record<DuplicateSuggestion['reason'], string> = {
  SAME_ADDRESS: 'Same address',
  SIMILAR_NAME: 'Same name',
  NEARBY: 'Nearby',
}

async function submit() {
  if (!canAdvance.value || submitting.value || !bbox.value) return
  submitting.value = true
  errorMessage.value = ''

  try {
    await $fetch('/api/locations', {
      method: 'POST',
      body: {
        name: form.name.trim(),
        type: form.type,
        addressLine1: form.addressLine1.trim(),
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        postalCode: form.postalCode.trim() || null,
        latitude: latitude.value,
        longitude: longitude.value,
        boundary: polygonFromBbox(bbox.value),
        capacity: Number(form.capacity) || 0,
        acknowledgeDuplicates: acknowledgeDuplicates.value,
      },
    })
    await navigateTo(returnTo.value)
  }
  catch (error) {
    const candidate = error as { statusCode?: number, data?: { duplicates?: DuplicateSuggestion[] } }
    if (candidate.statusCode === 409 && candidate.data?.duplicates?.length) {
      duplicates.value = candidate.data.duplicates
      return
    }
    errorMessage.value = apiErrorMessage(error, 'Could not save the location.')
  }
  finally {
    submitting.value = false
  }
}

function createAnyway() {
  acknowledgeDuplicates.value = true
  duplicates.value = []
  submit()
}
</script>

<template>
  <section :class="user?.role === 'ADMIN' ? '' : 'd-page'">
    <PageHeader
      eyebrow="Location pool"
      :title="STEP_TITLES[step]"
      :back-to="returnTo"
      back-label="Back"
    />

    <div
      class="stepper"
      role="progressbar"
      :aria-valuenow="stepIndex + 1"
      aria-valuemin="1"
      :aria-valuemax="STEPS.length"
      :aria-label="`Step ${stepIndex + 1} of ${STEPS.length}`"
    >
      <span
        v-for="(name, index) in STEPS"
        :key="name"
        class="stepper-step"
        :class="{ done: index < stepIndex, on: index === stepIndex }"
      />
    </div>

    <p
      v-if="errorMessage"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ errorMessage }}</span>
    </p>

    <div
      v-if="duplicates.length"
      class="card mb-4 border-[var(--color-amber-500)] p-4"
      role="alert"
    >
      <span class="eyebrow">Possible duplicate</span>
      <p class="mt-2 mb-3 text-sm">
        A very similar location already exists. Reusing it keeps container history in one place.
      </p>
      <NuxtLink
        v-for="dupe in duplicates"
        :key="dupe.id"
        :to="`/containers?locationId=${dupe.id}`"
        class="row -mx-4 px-4"
      >
        <span class="row-main">
          <b>{{ dupe.name }}</b>
          <small>
            {{ DUPLICATE_REASONS[dupe.reason] }}
            <template v-if="dupe.distanceMeters != null"> · {{ dupe.distanceMeters }} m away</template>
          </small>
        </span>
      </NuxtLink>
      <button
        class="btn-ghost mt-3"
        @click="createAnyway"
      >
        These are different — create anyway
      </button>
    </div>

    <template v-if="step === 'type'">
      <div class="type-grid">
        <button
          v-for="type in LOCATION_TYPES"
          :key="type"
          type="button"
          :aria-pressed="form.type === type"
          @click="form.type = type"
        >
          <b>{{ LOCATION_GLYPH[type] }} {{ LOCATION_TYPE_LABELS[type] }}</b>
        </button>
      </div>
    </template>

    <template v-else-if="step === 'name'">
      <div class="card p-4">
        <label class="field !mb-0">
          <span>Location name</span>
          <input
            v-model="form.name"
            class="input"
            :placeholder="form.type === 'CUSTOMER' ? 'Coastal Tile Imports' : 'Port Everglades Terminal 3'"
            autocomplete="off"
          >
        </label>
      </div>
    </template>

    <template v-else-if="step === 'address'">
      <div class="card p-4">
        <label class="field !mb-0">
          <span>Address</span>
          <input
            v-model="form.addressQuery"
            class="input"
            placeholder="Start typing a street, terminal or city"
            autocomplete="off"
            autocapitalize="words"
          >
          <small class="field-hint">
            Suggestions come from OpenStreetMap. No API key. Pick a result to drop the pin.
          </small>
        </label>

        <p
          v-if="searching"
          class="mt-2 text-sm text-[var(--color-ink-500)]"
        >
          Searching…
        </p>
        <p
          v-else-if="suggestError"
          class="banner warn mt-3 mb-0"
        >
          <span aria-hidden="true">!</span>
          <span>{{ suggestError }}</span>
        </p>

        <div
          v-if="suggestions.length"
          class="suggest-list"
          role="listbox"
        >
          <button
            v-for="hit in suggestions"
            :key="`${hit.latitude},${hit.longitude},${hit.displayName}`"
            type="button"
            class="row"
            @click="applySuggestion(hit)"
          >
            <span class="row-main">
              <b>{{ hit.displayName }}</b>
              <small>{{ [hit.city, hit.state].filter(Boolean).join(', ') || 'OpenStreetMap' }}</small>
            </span>
            <span
              class="row-end"
              aria-hidden="true"
            >›</span>
          </button>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="card p-4 mb-4">
        <label class="field">
          <span>Capacity (container slots)</span>
          <input
            v-model.number="form.capacity"
            class="input mono"
            type="number"
            min="0"
            max="100000"
            inputmode="numeric"
          >
          <small class="field-hint">
            Used to generate the 2D yard — rows of slots inside the fence you draw.
          </small>
        </label>
      </div>

      <ClientOnly>
        <LocationMapEditor
          :latitude="latitude"
          :longitude="longitude"
          :bbox="bbox"
          @update:bbox="bbox = $event"
        />
      </ClientOnly>

      <div class="mt-4">
        <YardModelPreview
          :model="model"
          :location-name="form.name"
        />
      </div>
    </template>

    <div class="mt-6 flex gap-3">
      <button
        v-if="stepIndex > 0"
        type="button"
        class="btn-ghost flex-1"
        @click="back"
      >
        Back
      </button>
      <button
        v-if="step !== 'map'"
        type="button"
        class="btn-dark flex-1"
        :disabled="!canAdvance"
        @click="next"
      >
        Continue
      </button>
      <button
        v-else
        type="button"
        class="btn-primary-action flex-1 !w-auto"
        :disabled="!canAdvance || submitting"
        @click="submit"
      >
        {{ submitting ? 'Saving…' : 'Save location' }}
      </button>
    </div>
  </section>
</template>
