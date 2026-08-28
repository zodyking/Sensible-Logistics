<script setup lang="ts">
import { LOCATION_TYPE_LABELS } from '#shared/utils/domain'

const route = useRoute()
const tripId = computed(() => String(route.params.id))

useHead({ title: 'Change drop-off' })

const { data, error, status } = await useFetch(() => `/api/trips/${tripId.value}`)

const search = ref('')
const debounced = ref('')
let debounceTimer: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounced.value = value
  }, 300)
})
onBeforeUnmount(() => clearTimeout(debounceTimer))

const { data: locationList } = await useFetch('/api/locations', {
  query: computed(() => ({ q: debounced.value || undefined, limit: 50 })),
})

const selectedId = ref<string | null>(null)
watch(data, (value) => {
  if (value?.destination?.id && !selectedId.value) {
    selectedId.value = value.destination.id
  }
}, { immediate: true })

const saving = ref(false)
const errorMessage = ref('')

async function save() {
  if (!selectedId.value || saving.value) return
  saving.value = true
  errorMessage.value = ''
  try {
    await $fetch(`/api/trips/${tripId.value}/destination`, {
      method: 'POST',
      body: { destinationLocationId: selectedId.value },
    })
    await navigateTo(`/trips/${tripId.value}`)
  }
  catch (err) {
    errorMessage.value = apiErrorMessage(err, 'Could not change the drop-off.')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="d-page">
    <div
      v-if="status === 'pending'"
      class="card p-6 text-center text-sm text-[var(--color-ink-500)]"
      role="status"
    >
      Loading trip…
    </div>

    <p
      v-else-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ apiErrorMessage(error, 'Trip not found.') }}</span>
    </p>

    <template v-else-if="data">
      <PageHeader
        eyebrow="Drop-off"
        title="Where is this going?"
        :back-to="`/trips/${tripId}`"
        back-label="Trip"
      />
      <p class="mb-4 text-sm text-[var(--color-ink-500)]">
        This only updates the planned destination. You place the container on the map when you arrive.
      </p>

      <p
        v-if="errorMessage"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ errorMessage }}</span>
      </p>

      <div class="searchbar">
        <span aria-hidden="true">⌕</span>
        <input
          v-model="search"
          type="search"
          placeholder="Search yards, customers, terminals…"
          aria-label="Search drop-off locations"
        >
      </div>

      <div
        v-if="locationList?.items.length"
        class="card rowlist"
      >
        <button
          v-for="location in locationList.items"
          :key="location.id"
          type="button"
          class="row"
          :aria-pressed="selectedId === location.id"
          @click="selectedId = location.id"
        >
          <span class="row-main">
            <b>{{ location.name }}</b>
            <small>
              {{ LOCATION_TYPE_LABELS[location.type] }}
              <template v-if="location.addressLine1"> · {{ location.addressLine1 }}</template>
            </small>
          </span>
          <span class="row-end">
            <StatusChip
              v-if="selectedId === location.id"
              variant="ok"
              label="Selected"
            />
            <span
              v-else
              aria-hidden="true"
            >›</span>
          </span>
        </button>
      </div>

      <EmptyState
        v-else
        glyph="◫"
        title="No locations match"
        description="Pick an existing location. Add new ones from More → Customers & locations."
      />

      <button
        type="button"
        class="btn-primary-action mt-6"
        :disabled="!selectedId || saving"
        @click="save"
      >
        {{ saving ? 'Saving…' : 'Save drop-off' }}
      </button>
    </template>
  </section>
</template>
