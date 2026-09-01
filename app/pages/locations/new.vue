<script setup lang="ts">
import { LOCATION_TYPE_GROUPS, LOCATION_TYPE_LABELS } from '#shared/utils/domain'
import type { LocationType } from '#shared/utils/domain'
import { isPlacedPin } from '#shared/utils/yard-slots'
import { formatPhoneInput, isBlankOrValidPhone } from '#shared/utils/phone'
import { formatCityStateZip, parseUsAddressQuery } from '#shared/utils/us-address'

const { user } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')

useHead({ title: 'Add location' })

const route = useRoute()
const returnTo = computed(() => {
  const raw = String(route.query.returnTo ?? '')
  return raw.startsWith('/') ? raw : '/locations'
})

type Step = 'type' | 'name' | 'phones' | 'address'
const STEPS: Step[] = ['type', 'name', 'phones', 'address']
const STEP_TITLES: Record<Step, string> = {
  type: 'New location',
  name: 'Name',
  phones: 'Contact',
  address: 'Address',
}

type PlaceHit = {
  displayName: string
  latitude: number
  longitude: number
  addressLine1: string | null
  city: string | null
  state: string | null
  postalCode: string | null
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

const suggestions = ref<PlaceHit[]>([])
const searching = ref(false)
const suggestError = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
let applyingSuggestion = false

watch(() => form.addressQuery, (value) => {
  if (applyingSuggestion) return
  latitude.value = null
  longitude.value = null
  form.addressLine1 = ''
  form.city = ''
  form.state = ''
  form.postalCode = ''
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

async function applySuggestion(hit: PlaceHit) {
  applyingSuggestion = true
  form.addressLine1 = hit.addressLine1 || hit.displayName
  form.city = hit.city ?? ''
  form.state = hit.state ?? ''
  form.postalCode = hit.postalCode ?? ''
  form.addressQuery = hit.displayName
  latitude.value = hit.latitude
  longitude.value = hit.longitude
  suggestions.value = []
  void nextTick(() => {
    applyingSuggestion = false
  })
}

function commitTypedAddress() {
  if (isPlacedPin(latitude.value, longitude.value) && form.addressLine1.trim()) return
  const parsed = parseUsAddressQuery(form.addressQuery)
  form.addressLine1 = parsed.addressLine1 || form.addressQuery.trim()
  form.city = parsed.city ?? ''
  form.state = parsed.state ?? ''
  form.postalCode = parsed.postalCode ?? ''
}

const canAdvance = computed(() => {
  switch (step.value) {
    case 'type': return Boolean(form.type)
    case 'name': return form.name.trim().length >= 2
    case 'phones': return isBlankOrValidPhone(form.mainPhone) && isBlankOrValidPhone(form.contactPhone)
    case 'address': return form.addressQuery.trim().length >= 2
  }
  return false
})

async function next() {
  if (step.value === 'address') {
    commitTypedAddress()
    if (!form.addressLine1.trim()) return
    await submit()
    return
  }
  const index = stepIndex.value
  if (index < STEPS.length - 1) step.value = STEPS[index + 1]!
}

function back() {
  const index = stepIndex.value
  if (index > 0) step.value = STEPS[index - 1]!
}

watch(step, scrollWizardToTop)

/** The kind row commits and moves on, the way a native list does. */
function pickType(type: LocationType) {
  form.type = type
  void next()
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
  commitTypedAddress()
  if (!form.addressLine1.trim() || submitting.value) return
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
        latitude: isPlacedPin(latitude.value, longitude.value) ? latitude.value : null,
        longitude: isPlacedPin(latitude.value, longitude.value) ? longitude.value : null,
        mainPhone: form.mainPhone.trim() || null,
        contactName: form.contactName.trim() || null,
        contactPhone: form.contactPhone.trim() || null,
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
    <WizardNav
      :title="STEP_TITLES[step]"
      :back-to="stepIndex > 0 ? undefined : returnTo"
      @back="back"
    />

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
      <template
        v-for="group in LOCATION_TYPE_GROUPS"
        :key="group.key"
      >
        <span class="wiz-label">{{ group.label }}</span>
        <div class="wiz-group">
          <button
            v-for="type in group.types"
            :key="type"
            type="button"
            class="wiz-pick"
            :aria-pressed="form.type === type"
            @click="pickType(type)"
          >
            <span
              class="wiz-pick-ico"
              aria-hidden="true"
            >
              <LocationIcon :name="type" />
            </span>
            <span class="wiz-pick-main">
              <b>{{ LOCATION_TYPE_LABELS[type] }}</b>
            </span>
            <span
              v-if="form.type === type"
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
    </template>

    <template v-else-if="step === 'name'">
      <span class="wiz-label">Name</span>
      <div class="wiz-group">
        <div class="wiz-row">
          <label
            class="wiz-row-label"
            for="location-name"
          >Name</label>
          <input
            id="location-name"
            v-model="form.name"
            class="input"
            :placeholder="form.type === 'CUSTOMER' ? 'Coastal Tile Imports' : 'Port Everglades Terminal 3'"
            autocomplete="off"
          >
        </div>
      </div>
      <p class="wiz-hint">
        Locations are company-wide. Every driver sees this yard, terminal, or customer.
      </p>
    </template>

    <template v-else-if="step === 'phones'">
      <span class="wiz-label">Phone</span>
      <div class="wiz-group">
        <div class="wiz-row">
          <label
            class="wiz-row-label"
            for="location-main-phone"
          >Main</label>
          <input
            id="location-main-phone"
            :value="form.mainPhone"
            class="input"
            type="tel"
            inputmode="tel"
            autocomplete="tel"
            placeholder="optional"
            @input="onPhoneInput('mainPhone', $event)"
          >
        </div>
      </div>

      <span class="wiz-label">Person on site</span>
      <div class="wiz-group">
        <div class="wiz-row">
          <label
            class="wiz-row-label"
            for="location-contact-name"
          >Name</label>
          <input
            id="location-contact-name"
            v-model="form.contactName"
            class="input"
            autocomplete="name"
            placeholder="gate office, dispatcher…"
          >
        </div>
        <div class="wiz-row">
          <label
            class="wiz-row-label"
            for="location-contact-phone"
          >Phone</label>
          <input
            id="location-contact-phone"
            :value="form.contactPhone"
            class="input"
            type="tel"
            inputmode="tel"
            autocomplete="tel"
            placeholder="optional"
            @input="onPhoneInput('contactPhone', $event)"
          >
        </div>
      </div>
      <p class="wiz-hint">
        Leave this screen blank if you do not have a number.
      </p>
    </template>

    <template v-else-if="step === 'address'">
      <span class="wiz-label">Address</span>
      <div class="wiz-group">
        <div class="wiz-row">
          <label
            class="wiz-row-label"
            for="location-address"
          >Street</label>
          <input
            id="location-address"
            v-model="form.addressQuery"
            class="input"
            placeholder="required"
            autocomplete="off"
            autocapitalize="words"
          >
        </div>
      </div>
      <p class="wiz-hint">
        Type the address. Suggestions are optional — you do not have to pick one.
      </p>

      <p
        v-if="searching"
        class="wiz-hint"
        role="status"
      >
        Searching…
      </p>
      <p
        v-else-if="suggestError"
        class="banner warn mt-3"
      >
        <span aria-hidden="true">!</span>
        <span>{{ suggestError }}</span>
      </p>

      <template v-if="suggestions.length">
        <span class="wiz-label">Suggestions</span>
        <div
          class="wiz-group"
          role="listbox"
        >
          <button
            v-for="hit in suggestions"
            :key="`${hit.latitude},${hit.longitude},${hit.displayName}`"
            type="button"
            class="wiz-pick"
            role="option"
            :aria-selected="form.addressQuery === hit.displayName"
            @click="applySuggestion(hit)"
          >
            <span class="wiz-pick-main">
              <b>{{ hit.displayName }}</b>
              <small>{{ formatCityStateZip(hit.city, hit.state, hit.postalCode) || 'OpenStreetMap' }}</small>
            </span>
            <span
              class="wiz-chev"
              aria-hidden="true"
            >›</span>
          </button>
        </div>
      </template>
    </template>

    <div
      v-if="step !== 'type'"
      class="wiz-actions"
    >
      <button
        type="button"
        class="wiz-next"
        :disabled="!canAdvance || submitting"
        @click="next"
      >
        {{ step === 'address' ? (submitting ? 'Saving…' : 'Save location') : 'Next' }}
      </button>
    </div>
  </section>
</template>
