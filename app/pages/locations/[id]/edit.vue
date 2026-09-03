<script setup lang="ts">
import { LOCATION_TYPE_LABELS, LOCATION_TYPES } from '#shared/utils/domain'
import type { LocationType } from '#shared/utils/domain'
import type { GeoJsonPolygon } from '#shared/utils/geo'
import { isPlacedPin } from '#shared/utils/yard-slots'
import { formatPhoneInput, isValidPhone } from '#shared/utils/phone'
import { formatCityStateZip, parseUsAddressQuery } from '#shared/utils/us-address'

const { user } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')

const route = useRoute()
const locationId = computed(() => String(route.params.id))

type PlaceHit = {
  displayName: string
  latitude: number
  longitude: number
  addressLine1: string | null
  city: string | null
  state: string | null
  postalCode: string | null
}

const loading = ref(true)
const submitting = ref(false)
const errorMessage = ref('')
const isUncategorized = ref(false)
const locationName = ref('Location')

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
const heading = ref(0)
const boundary = ref<GeoJsonPolygon | null>(null)
const addressDirty = ref(false)
const suggestions = ref<PlaceHit[]>([])
const searching = ref(false)
const suggestError = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
let applyingSuggestion = false

useHead({ title: () => `Edit ${locationName.value}` })

onMounted(async () => {
  try {
    const data = await $fetch<{
      location: {
        name: string
        type: LocationType
        isUncategorized?: boolean
        mainPhone: string | null
        contactName: string | null
        contactPhone: string | null
        addressLine1: string | null
        city: string | null
        state: string | null
        postalCode: string | null
        latitude: number | null
        longitude: number | null
        mapHeading?: number | null
        boundary?: GeoJsonPolygon | null
      }
    }>(`/api/locations/${locationId.value}`)
    const loc = data.location
    locationName.value = loc.name
    isUncategorized.value = Boolean(loc.isUncategorized)
    form.type = loc.type
    form.name = loc.name
    form.mainPhone = formatPhoneInput(loc.mainPhone)
    form.contactName = loc.contactName ?? ''
    form.contactPhone = formatPhoneInput(loc.contactPhone)
    form.addressLine1 = loc.addressLine1 ?? ''
    form.city = loc.city ?? ''
    form.state = loc.state ?? ''
    form.postalCode = loc.postalCode ?? ''
    form.addressQuery = [loc.addressLine1, loc.city, loc.state].filter(Boolean).join(', ')
    latitude.value = loc.latitude
    longitude.value = loc.longitude
    heading.value = loc.mapHeading ?? 0
    boundary.value = loc.boundary ?? null
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not load this location.')
  }
  finally {
    loading.value = false
  }
})

onBeforeUnmount(() => clearTimeout(searchTimer))

watch(() => form.addressQuery, (value) => {
  if (applyingSuggestion || !addressDirty.value) return
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

function onPhoneInput(field: 'mainPhone' | 'contactPhone', event: Event) {
  const input = event.target as HTMLInputElement
  const formatted = formatPhoneInput(input.value)
  form[field] = formatted
  if (input.value !== formatted) input.value = formatted
}

function onAddressTyped(event: Event) {
  applyingSuggestion = false
  addressDirty.value = true
  form.addressQuery = (event.target as HTMLInputElement).value
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

function applySuggestion(hit: PlaceHit) {
  applyingSuggestion = true
  form.addressLine1 = hit.addressLine1 || hit.displayName
  form.city = hit.city ?? ''
  form.state = hit.state ?? ''
  form.postalCode = hit.postalCode ?? ''
  form.addressQuery = hit.displayName
  latitude.value = hit.latitude
  longitude.value = hit.longitude
  suggestions.value = []
  addressDirty.value = false
  void nextTick(() => {
    applyingSuggestion = false
  })
}

async function save() {
  if (submitting.value) return
  errorMessage.value = ''

  if (!isUncategorized.value && form.name.trim().length < 2) {
    errorMessage.value = 'Give the location a name.'
    return
  }
  if (form.mainPhone && !isValidPhone(form.mainPhone)) {
    errorMessage.value = 'Enter a 10-digit United States phone number.'
    return
  }
  if (form.contactPhone && !isValidPhone(form.contactPhone)) {
    errorMessage.value = 'Enter a 10-digit United States phone number.'
    return
  }

  submitting.value = true
  try {
    const body: Record<string, unknown> = {
      mainPhone: form.mainPhone.trim() || null,
      contactName: form.contactName.trim() || null,
      contactPhone: form.contactPhone.trim() || null,
    }
    if (!isUncategorized.value) {
      body.type = form.type
      body.name = form.name.trim()
    }
    if (addressDirty.value) {
      const parsed = parseUsAddressQuery(form.addressQuery)
      const street = parsed.addressLine1 || form.addressQuery.trim()
      if (street) {
        body.addressLine1 = street
        body.city = parsed.city
        body.state = parsed.state
        body.postalCode = parsed.postalCode
        body.latitude = isPlacedPin(latitude.value, longitude.value) ? latitude.value : null
        body.longitude = isPlacedPin(latitude.value, longitude.value) ? longitude.value : null
      }
    }
    else if (isPlacedPin(latitude.value, longitude.value) && form.addressLine1) {
      body.addressLine1 = form.addressLine1
      body.city = form.city || null
      body.state = form.state || null
      body.postalCode = form.postalCode || null
      body.latitude = latitude.value
      body.longitude = longitude.value
    }
    if (boundary.value) body.boundary = boundary.value
    body.mapHeading = heading.value
    await $fetch(`/api/locations/${locationId.value}`, { method: 'PATCH', body })
    await navigateTo(`/locations/${locationId.value}`)
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not save the location.')
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <section :class="user?.role === 'ADMIN' ? '' : 'd-page'">
    <PageHeader
      eyebrow="Edit location"
      :title="loading ? 'Location' : locationName"
      :back-to="`/locations/${locationId}`"
      back-label="Location"
    />

    <p
      v-if="errorMessage"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ errorMessage }}</span>
    </p>

    <p
      v-else-if="isUncategorized"
      class="banner warn"
    >
      <span aria-hidden="true">!</span>
      <span>Uncategorized holds equipment from deleted sites. Name and type stay fixed.</span>
    </p>

    <div
      v-if="loading"
      class="card p-6 text-center text-sm text-[var(--color-ink-500)]"
      role="status"
    >
      Loading location…
    </div>

    <form
      v-else
      class="flex flex-col gap-4"
      @submit.prevent="save"
    >
      <div class="card p-4">
        <label class="field">
          <span>Type</span>
          <select
            v-model="form.type"
            class="select"
            :disabled="isUncategorized"
          >
            <option
              v-for="type in LOCATION_TYPES"
              :key="type"
              :value="type"
            >
              {{ LOCATION_TYPE_LABELS[type] }}
            </option>
          </select>
        </label>

        <label class="field">
          <span>Name</span>
          <input
            v-model="form.name"
            class="input"
            :disabled="isUncategorized"
            autocomplete="off"
          >
        </label>

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
          <small class="field-hint">Optional.</small>
        </label>

        <label class="field">
          <span>Contact name</span>
          <input
            v-model="form.contactName"
            class="input"
            autocomplete="name"
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
          <small class="field-hint">Optional.</small>
        </label>
      </div>

      <div class="card p-4">
        <label class="field !mb-0">
          <span>Address</span>
          <input
            :value="form.addressQuery"
            class="input"
            placeholder="Start typing a US street, terminal, or city"
            autocomplete="off"
            autocapitalize="words"
            @input="onAddressTyped"
          >
          <small class="field-hint">
            Type the address. Suggestions are optional — you do not have to pick one.
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
              <small>{{ formatCityStateZip(hit.city, hit.state, hit.postalCode) || 'OpenStreetMap' }}</small>
            </button>
          </li>
        </ul>
      </div>

      <div
        v-if="!isUncategorized"
        class="card p-4"
      >
        <p class="eyebrow mb-2">
          Yard zone
        </p>
        <p class="field-hint mb-3">
          Draw the usable yard around this site. Existing locations keep their address — you can add the zone here without recreating them.
        </p>
        <ClientOnly>
          <LocationMapEditor
            :latitude="latitude"
            :longitude="longitude"
            :boundary="boundary"
            :heading="heading"
            :address-line1="form.addressLine1"
            :city="form.city"
            :state="form.state"
            :postal-code="form.postalCode"
            @update:boundary="boundary = $event"
            @update:heading="heading = $event"
          />
          <template #fallback>
            <div
              class="location-map place"
              aria-hidden="true"
            />
          </template>
        </ClientOnly>
      </div>

      <button
        class="btn-dark w-full"
        type="submit"
        :disabled="submitting"
      >
        {{ submitting ? 'Saving…' : 'Save' }}
      </button>
    </form>
  </section>
</template>
