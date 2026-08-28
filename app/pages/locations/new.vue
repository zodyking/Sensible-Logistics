<script setup lang="ts">
import { LOCATION_TYPE_LABELS, LOCATION_TYPES } from '#shared/utils/domain'
import type { LocationType } from '#shared/utils/domain'
import { bboxAround, normalizeHeading, type BoundingBox, type GeoJsonPolygon } from '#shared/utils/geo'
import { isPlacedPin } from '#shared/utils/yard-slots'
import { fetchMapBearing } from '~/utils/leaflet-map'
import { formatPhoneInput, isValidPhone } from '#shared/utils/phone'

const { user } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')

useHead({ title: 'Add location' })

const route = useRoute()
const returnTo = computed(() => {
  const raw = String(route.query.returnTo ?? '')
  return raw.startsWith('/') ? raw : '/locations'
})

type Step = 'type' | 'name' | 'phones' | 'address' | 'map'
const STEPS: Step[] = ['type', 'name', 'phones', 'address', 'map']
const STEP_TITLES: Record<Step, string> = {
  type: 'What kind of location?',
  name: 'What do you call it?',
  phones: 'How do we reach them?',
  address: 'Where is it?',
  map: 'Frame the yard',
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
  mainPhone: '',
  contactName: '',
  contactPhone: '',
  addressQuery: '',
  addressLine1: '',
  city: '',
  state: '',
  postalCode: '',
})

const latitude = ref<number | null>(null)
const longitude = ref<number | null>(null)
const bbox = ref<BoundingBox | null>(null)
const fence = ref<GeoJsonPolygon | null>(null)
const heading = ref(0)
const aligningMap = ref(false)
const mapRef = ref<{ recenter: () => void, captureFence: () => GeoJsonPolygon | null } | null>(null)

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

function onPhoneInput(field: 'mainPhone' | 'contactPhone', event: Event) {
  const input = event.target as HTMLInputElement
  const formatted = formatPhoneInput(input.value)
  form[field] = formatted
  if (input.value !== formatted) input.value = formatted
}

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

async function applySuggestion(hit: PlaceHit, advance = true) {
  form.addressLine1 = hit.addressLine1 || hit.displayName
  form.city = hit.city ?? ''
  form.state = hit.state ?? ''
  form.postalCode = hit.postalCode ?? ''
  form.addressQuery = hit.displayName
  latitude.value = hit.latitude
  longitude.value = hit.longitude
  bbox.value = hit.bbox ?? bboxAround(hit.latitude, hit.longitude, 80)
  fence.value = null
  suggestions.value = []
  try {
    heading.value = await fetchMapBearing(hit.latitude, hit.longitude, bbox.value)
  }
  catch {
    heading.value = 0
  }
  if (advance) step.value = 'map'
}

const canAdvance = computed(() => {
  switch (step.value) {
    case 'type': return Boolean(form.type)
    case 'name': return form.name.trim().length >= 2
    case 'phones': return isValidPhone(form.mainPhone) && isValidPhone(form.contactPhone)
    case 'address': return form.addressQuery.trim().length >= 3 || Boolean(isPlacedPin(latitude.value, longitude.value) && form.addressLine1)
    case 'map': return isPlacedPin(latitude.value, longitude.value)
  }
  return false
})

async function next() {
  if (step.value === 'address' && !isPlacedPin(latitude.value, longitude.value)) {
    const query = form.addressQuery.trim()
    if (query.length < 3) return
    if (!suggestions.value.length) await lookupAddress(query)
    const first = suggestions.value[0]
    if (!first) {
      suggestError.value = suggestError.value || 'No United States address matched. Try a street and city.'
      return
    }
    await applySuggestion(first, true)
    return
  }
  const index = stepIndex.value
  if (index < STEPS.length - 1) step.value = STEPS[index + 1]!
}

function back() {
  const index = stepIndex.value
  if (index > 0) step.value = STEPS[index - 1]!
}

async function alignNewMap() {
  if (!isPlacedPin(latitude.value, longitude.value)) return
  aligningMap.value = true
  try {
    heading.value = await fetchMapBearing(latitude.value, longitude.value, bbox.value)
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not read the nearby street.')
  }
  finally {
    aligningMap.value = false
  }
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
  if (!canAdvance.value || submitting.value) return
  // If the user framed the yard but never tapped Set fence, capture the view for them.
  const boundary = fence.value ?? mapRef.value?.captureFence() ?? null
  if (!boundary) {
    errorMessage.value = 'Frame the yard on the map, then save.'
    return
  }
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
        country: 'US',
        latitude: latitude.value,
        longitude: longitude.value,
        mapHeading: heading.value,
        boundary,
        mainPhone: form.mainPhone,
        contactName: form.contactName.trim() || null,
        contactPhone: form.contactPhone,
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
        :to="`/locations/${dupe.id}`"
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
          <b>{{ LOCATION_TYPE_LABELS[type] }}</b>
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
      <p class="mt-3 text-sm text-[var(--color-ink-500)]">
        Locations are company-wide. Every driver sees this yard, terminal, or customer.
      </p>
    </template>

    <template v-else-if="step === 'phones'">
      <div class="card p-4">
        <label class="field">
          <span>Main number</span>
          <input
            :value="form.mainPhone"
            class="input"
            type="tel"
            inputmode="tel"
            autocomplete="tel"
            placeholder="(954) 555-0100"
            @input="onPhoneInput('mainPhone', $event)"
          >
          <small class="field-hint">Company switchboard for this site.</small>
        </label>
        <label class="field">
          <span>Contact name</span>
          <input
            v-model="form.contactName"
            class="input"
            autocomplete="name"
            placeholder="Gate office, dispatcher, receiving…"
          >
        </label>
        <label class="field !mb-0">
          <span>Contact number</span>
          <input
            :value="form.contactPhone"
            class="input"
            type="tel"
            inputmode="tel"
            autocomplete="tel"
            placeholder="(954) 555-0142"
            @input="onPhoneInput('contactPhone', $event)"
          >
          <small class="field-hint">Direct line for the person at this location.</small>
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
            placeholder="Start typing a US street, terminal, or city"
            autocomplete="off"
            autocapitalize="words"
          >
          <small class="field-hint">
            United States addresses only. Pick a result to drop the pin.
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

        <ul
          v-if="suggestions.length"
          class="suggest-list"
          role="listbox"
        >
          <li
            v-for="hit in suggestions"
            :key="`${hit.latitude},${hit.longitude},${hit.displayName}`"
          >
            <button
              type="button"
              class="suggest-item"
              role="option"
              @click="applySuggestion(hit)"
            >
              <b>{{ hit.displayName }}</b>
              <small>{{ [hit.city, hit.state, hit.postalCode].filter(Boolean).join(', ') || 'OpenStreetMap' }}</small>
            </button>
          </li>
        </ul>
      </div>
    </template>

    <template v-else>
      <MapRotateBar
        class="mb-3"
        :heading="heading"
        :aligning="aligningMap"
        @rotate="heading = normalizeHeading(heading + $event)"
        @align="alignNewMap"
        @recenter="mapRef?.recenter()"
      />
      <ClientOnly>
        <LocationMapEditor
          ref="mapRef"
          :latitude="latitude"
          :longitude="longitude"
          :boundary="fence"
          :heading="heading"
          @update:boundary="fence = $event"
          @update:heading="heading = $event"
        />
      </ClientOnly>
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
