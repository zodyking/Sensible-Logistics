<script setup lang="ts">
import type { GeoJsonPolygon } from '#shared/utils/geo'

const { user } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')

const route = useRoute()
const locationId = computed(() => String(route.params.id))

if (user.value?.role !== 'ADMIN') {
  await navigateTo(`/locations/${locationId.value}/yard`)
}

const { data, error, status } = await useFetch(() => `/api/locations/${locationId.value}`)
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

function capture() {
  const next = editor.value?.captureFence()
  if (next) boundary.value = next
}

async function generate() {
  capture()
  if (!boundary.value) {
    errorMessage.value = 'Set the fence so it hugs the usable yard.'
    return
  }
  submitting.value = true
  errorMessage.value = ''
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
  <section class="d-page">
    <PageHeader
      eyebrow="Yard"
      title="Draw the usable area"
      :back-to="`/locations/${locationId}/yard`"
      back-label="Yard"
    />

    <p class="wiz-hint">
      Align to the street, then fill the gold frame with pavement, buildings, and the gate.
      The operational view will be a clean 2D plan — not this map.
    </p>

    <p
      v-if="error || errorMessage"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ errorMessage || apiErrorMessage(error, 'Location not found.') }}</span>
    </p>

    <p
      v-else-if="status === 'pending'"
      class="wiz-hint"
    >
      Loading location…
    </p>

    <template v-else-if="data">
      <LocationMapEditor
        ref="editor"
        :latitude="data.location.latitude"
        :longitude="data.location.longitude"
        :boundary="boundary"
        :heading="heading"
        @update:boundary="boundary = $event"
        @update:heading="heading = $event"
      />

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
