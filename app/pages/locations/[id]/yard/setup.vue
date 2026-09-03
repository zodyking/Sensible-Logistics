<script setup lang="ts">
import type { GeoJsonPolygon } from '#shared/utils/geo'
import { isPlausibleYardFence } from '#shared/utils/geo'

const { user } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')

const route = useRoute()
const locationId = computed(() => String(route.params.id))

const { data, error, status, refresh } = await useFetch(() => `/api/locations/${locationId.value}`)
useHead({ title: () => `Generate yard · ${data.value?.location.name ?? 'Location'}` })

const editor = ref<{ captureFence: () => GeoJsonPolygon | null } | null>(null)
const heading = ref(0)
const boundary = ref<GeoJsonPolygon | null>(null)
const submitting = ref(false)
const errorMessage = ref('')

watch(data, (value) => {
  if (!value) return
  heading.value = value.location.mapHeading ?? 0
  if (value.location.boundary) boundary.value = value.location.boundary as GeoJsonPolygon
}, { immediate: true })

function captureIfNeeded() {
  if (boundary.value && isPlausibleYardFence(boundary.value)) return
  const next = editor.value?.captureFence()
  if (next) boundary.value = next
}

async function generate() {
  errorMessage.value = ''
  try {
    captureIfNeeded()
  }
  catch {
    errorMessage.value = 'Wait for the map to finish loading, then draw the zone.'
    return
  }
  if (!boundary.value) {
    errorMessage.value = 'Draw the zone around the usable yard, or zoom in and set the fence to this view.'
    return
  }
  if (!isPlausibleYardFence(boundary.value)) {
    errorMessage.value = 'That zone is too large. Zoom in until the gold frame hugs the yard, then set the fence.'
    return
  }
  submitting.value = true
  try {
    if (heading.value !== (data.value?.location.mapHeading ?? 0)) {
      await $fetch(`/api/locations/${locationId.value}`, {
        method: 'PATCH',
        body: { mapHeading: heading.value },
      })
    }
    await $fetch(`/api/locations/${locationId.value}/yard/generate`, {
      method: 'POST',
      body: { boundary: boundary.value },
    })
    await navigateTo(`/locations/${locationId.value}/yard`)
  }
  catch (err) {
    errorMessage.value = apiErrorMessage(err, 'Could not generate the yard plan.')
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <section :class="user?.role === 'ADMIN' ? '' : 'd-page'">
    <PageHeader
      eyebrow="Yard"
      title="Draw the usable area"
      :back-to="`/locations/${locationId}/yard`"
      back-label="Yard"
    />

    <p class="wiz-hint">
      Tap the corners of the usable yard on the aerial photo, or fill the gold frame and use this view as the fence.
      The operational view will be a clean 2D plan — not this map.
    </p>

    <p
      v-if="error && !data"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ apiErrorMessage(error, 'Location not found.') }}</span>
      <button
        type="button"
        class="btn-ghost ml-auto"
        @click="refresh()"
      >
        Try again
      </button>
    </p>

    <p
      v-else-if="status === 'pending' && !data"
      class="wiz-hint"
    >
      Loading location…
    </p>

    <template v-else-if="data">
      <p
        v-if="errorMessage"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ errorMessage }}</span>
      </p>

      <ClientOnly>
        <LocationMapEditor
          ref="editor"
          :latitude="data.location.latitude"
          :longitude="data.location.longitude"
          :boundary="boundary"
          :heading="heading"
          :address-line1="data.location.addressLine1"
          :city="data.location.city"
          :state="data.location.state"
          :postal-code="data.location.postalCode"
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

      <div class="wiz-actions">
        <button
          type="button"
          class="wiz-next"
          :disabled="submitting"
          @click="generate"
        >
          {{ submitting ? 'Building site plan…' : 'Generate 2D yard' }}
        </button>
      </div>
    </template>
  </section>
</template>
