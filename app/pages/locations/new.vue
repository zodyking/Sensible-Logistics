<script setup lang="ts">
import { LOCATION_TYPES, LOCATION_TYPE_LABELS } from '#shared/utils/domain'

useHead({ title: 'Add location' })

const form = reactive({
  name: '',
  type: 'CUSTOMER' as (typeof LOCATION_TYPES)[number],
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  capacity: '',
  notes: '',
})

const submitting = ref(false)
const errorMessage = ref('')
const fieldErrors = ref<Record<string, string>>({})
type DuplicateSuggestion = {
  id: string
  name: string
  reason: 'SAME_ADDRESS' | 'SIMILAR_NAME' | 'NEARBY'
  distanceMeters: number | null
}

const DUPLICATE_REASONS: Record<DuplicateSuggestion['reason'], string> = {
  SAME_ADDRESS: 'Same address',
  SIMILAR_NAME: 'Same name',
  NEARBY: 'Nearby',
}

const duplicates = ref<DuplicateSuggestion[]>([])
const acknowledgeDuplicates = ref(false)

const canSubmit = computed(() => form.name.trim().length >= 2 && form.addressLine1.trim().length >= 3)

async function submit() {
  if (!canSubmit.value || submitting.value) return
  submitting.value = true
  errorMessage.value = ''
  fieldErrors.value = {}

  try {
    await $fetch('/api/locations', {
      method: 'POST',
      body: {
        name: form.name.trim(),
        type: form.type,
        addressLine1: form.addressLine1.trim(),
        addressLine2: form.addressLine2.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        postalCode: form.postalCode.trim() || null,
        capacity: form.capacity ? Number(form.capacity) : null,
        driverNotes: form.notes.trim() || null,
        acknowledgeDuplicates: acknowledgeDuplicates.value,
      },
    })

    await navigateTo('/locations')
  }
  catch (error) {
    const candidate = error as {
      statusCode?: number
      data?: {
        duplicates?: DuplicateSuggestion[]
        data?: { issues?: Array<{ path: string, message: string }> }
      }
    }

    if (candidate.statusCode === 409 && candidate.data?.duplicates?.length) {
      duplicates.value = candidate.data.duplicates
      return
    }

    const issues = candidate.data?.data?.issues
    if (issues?.length) {
      fieldErrors.value = Object.fromEntries(issues.map(i => [i.path, i.message]))
      errorMessage.value = 'Check the highlighted fields.'
    }
    else {
      errorMessage.value = apiErrorMessage(error, 'Could not save the location.')
    }
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
  <section class="d-page">
    <PageHeader
      eyebrow="Location pool"
      title="Add a location"
      back-to="/locations"
      back-label="Locations"
    />

    <p
      v-if="errorMessage"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ errorMessage }}</span>
    </p>

    <!-- Duplicate prevention: locations are a shared company asset (spec 6.2). -->
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
        <span
          class="row-end"
          aria-hidden="true"
        >›</span>
      </NuxtLink>
      <button
        class="btn-ghost mt-3"
        @click="createAnyway"
      >
        These are different — create anyway
      </button>
    </div>

    <form
      class="card p-4"
      novalidate
      @submit.prevent="submit"
    >
      <label class="field">
        <span>Location name</span>
        <input
          v-model="form.name"
          class="input"
          :class="{ invalid: fieldErrors.name }"
          placeholder="Port Everglades Terminal 3"
          autocomplete="off"
          required
        >
      </label>

      <label class="field">
        <span>Type</span>
        <select
          v-model="form.type"
          class="input"
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
        <span>Street address</span>
        <input
          v-model="form.addressLine1"
          class="input"
          :class="{ invalid: fieldErrors.addressLine1 }"
          placeholder="1850 Eller Drive"
          autocomplete="address-line1"
          required
        >
      </label>

      <label class="field">
        <span>Suite / unit <small class="normal-case text-[var(--color-ink-400)]">optional</small></span>
        <input
          v-model="form.addressLine2"
          class="input"
          autocomplete="address-line2"
        >
      </label>

      <div class="grid grid-cols-[1fr_auto] gap-3">
        <label class="field">
          <span>City</span>
          <input
            v-model="form.city"
            class="input"
            autocomplete="address-level2"
          >
        </label>
        <label class="field">
          <span>State</span>
          <input
            v-model="form.state"
            class="input !w-20 uppercase"
            maxlength="2"
            autocomplete="address-level1"
          >
        </label>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <label class="field">
          <span>ZIP</span>
          <input
            v-model="form.postalCode"
            class="input mono"
            inputmode="numeric"
            autocomplete="postal-code"
          >
        </label>
        <label class="field">
          <span>Capacity <small class="normal-case text-[var(--color-ink-400)]">optional</small></span>
          <input
            v-model="form.capacity"
            class="input mono"
            inputmode="numeric"
            placeholder="240"
          >
        </label>
      </div>

      <label class="field">
        <span>Notes <small class="normal-case text-[var(--color-ink-400)]">optional</small></span>
        <textarea
          v-model="form.notes"
          class="input min-h-24 resize-y py-3"
          placeholder="Gate hours, appointment rules, driver instructions…"
        />
      </label>

      <!-- Geocoding + boundary drawing are Phase 2 (self-hosted Nominatim + tiles). -->
      <div class="mb-4">
        <span class="eyebrow">Boundary &amp; map</span>
        <YardMapPlaceholder class="mt-2" />
        <p class="mt-2 text-xs text-[var(--color-ink-500)]">
          Geocoding and boundary drawing arrive with the self-hosted map stack. The location saves
          now and can be geofenced later without re-entering anything.
        </p>
      </div>

      <button
        type="submit"
        class="btn-primary-action"
        :disabled="!canSubmit || submitting"
      >
        {{ submitting ? 'Saving…' : 'Save location' }}
      </button>
    </form>
  </section>
</template>
