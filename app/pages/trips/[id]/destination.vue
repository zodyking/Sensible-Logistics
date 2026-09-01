<script setup lang="ts">
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
      <WizardNav
        title="Drop-off"
        :back-to="`/trips/${tripId}`"
        back-label="Trip"
      />

      <p
        v-if="errorMessage"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ errorMessage }}</span>
      </p>

      <div class="searchbar wiz-search">
        <span aria-hidden="true">⌕</span>
        <input
          v-model="search"
          type="search"
          placeholder="Search yards, customers, terminals…"
          aria-label="Search drop-off locations"
        >
      </div>

      <LocationGroupedList
        v-if="locationList?.items.length"
        :items="locationList.items"
      >
        <template #default="{ item: location }">
          <button
            type="button"
            class="wiz-pick"
            :aria-pressed="selectedId === location.id"
            @click="selectedId = location.id"
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
                <template v-if="location.addressLine1">{{ location.addressLine1 }}</template>
              </small>
            </span>
            <span
              v-if="selectedId === location.id"
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

      <EmptyState
        v-else
        glyph="◫"
        title="No locations match"
        description="Pick an existing location. Add new ones from More → Customers & locations."
      />

      <p class="wiz-hint">
        This updates where Arrive will drop off. It does not finish the trip.
      </p>

      <div class="wiz-actions">
        <button
          type="button"
          class="wiz-next"
          :disabled="!selectedId || saving"
          @click="save"
        >
          {{ saving ? 'Saving…' : 'Save drop-off' }}
        </button>
      </div>
    </template>
  </section>
</template>
