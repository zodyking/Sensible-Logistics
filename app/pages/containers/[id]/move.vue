<script setup lang="ts">
import { LOCATION_GLYPH, LOCATION_TYPE_LABELS } from '#shared/utils/domain'
import { formatContainerNumber } from '#shared/utils/iso6346'

const { user } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')

const route = useRoute()
const id = computed(() => String(route.params.id))

const { data, error, status } = await useFetch(() => `/api/containers/${id.value}`)

useHead({ title: 'Move container' })

const search = ref('')
const submitting = ref(false)
const errorMessage = ref('')
const selectedId = ref<string | null>(null)

const { data: locationList } = await useFetch('/api/locations', {
  query: computed(() => ({
    q: search.value || undefined,
    limit: 50,
    lite: '1',
    includeUncategorized: '1',
  })),
})

const originId = computed(() => data.value?.currentLocation?.id ?? null)
const destinations = computed(() =>
  (locationList.value?.items ?? []).filter(item => item.id !== originId.value),
)

async function pickLocation(locationId: string) {
  selectedId.value = locationId
  await save()
}

async function save() {
  if (!selectedId.value || submitting.value) return
  submitting.value = true
  errorMessage.value = ''
  try {
    await $fetch(`/api/containers/${id.value}/move`, {
      method: 'POST',
      body: {
        eventId: crypto.randomUUID(),
        destinationLocationId: selectedId.value,
      },
    })
    await navigateTo(`/locations/${selectedId.value}`)
  }
  catch (err) {
    errorMessage.value = apiErrorMessage(err, 'Could not move this container.')
  }
  finally {
    submitting.value = false
  }
}

function locationAddressLine(location: { addressLine1: string | null, city: string | null, type: keyof typeof LOCATION_TYPE_LABELS }) {
  const bits = [LOCATION_TYPE_LABELS[location.type]]
  if (location.addressLine1) bits.push(location.addressLine1)
  if (location.city) bits.push(location.city)
  return bits.join(' · ')
}
</script>

<template>
  <section :class="user?.role === 'ADMIN' ? '' : 'd-page'">
    <div
      v-if="status === 'pending'"
      class="card p-6 text-center text-sm text-[var(--color-ink-500)]"
      role="status"
    >
      Loading container…
    </div>

    <p
      v-else-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ apiErrorMessage(error, 'Container not found.') }}</span>
    </p>

    <template v-else-if="data">
      <WizardNav
        title="Move"
        :back-to="`/containers/${id}`"
        back-label="Container"
      />

      <p
        v-if="errorMessage"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ errorMessage }}</span>
      </p>

      <span class="wiz-label">From</span>
      <div class="wiz-group">
        <div class="wiz-row">
          <span class="wiz-row-label">Box</span>
          <span class="mono flex-1">{{ formatContainerNumber(data.container.number) }}</span>
        </div>
        <div class="wiz-row">
          <span class="wiz-row-label">Yard</span>
          <span class="flex-1 text-[var(--color-ink-700)]">{{ data.currentLocation?.name ?? 'Not at a yard' }}</span>
        </div>
      </div>
      <p class="wiz-hint">
        Corrections only. The chassis attached to this box moves with it.
      </p>

      <div class="searchbar wiz-search">
        <span aria-hidden="true">⌕</span>
        <input
          v-model="search"
          type="search"
          placeholder="Search yards, terminals, customers…"
          aria-label="Search locations"
        >
      </div>

      <template v-if="destinations.length">
        <span class="wiz-label">Move to</span>
        <div class="wiz-group">
          <button
            v-for="location in destinations"
            :key="location.id"
            type="button"
            class="wiz-pick"
            :disabled="submitting"
            @click="pickLocation(location.id)"
          >
            <span
              class="wiz-pick-ico"
              aria-hidden="true"
            >{{ LOCATION_GLYPH[location.type] }}</span>
            <span class="wiz-pick-main">
              <b>{{ location.name }}</b>
              <small>{{ locationAddressLine(location) }}</small>
            </span>
            <span
              class="wiz-chev"
              aria-hidden="true"
            >›</span>
          </button>
        </div>
      </template>

      <EmptyState
        v-else
        glyph="◫"
        :title="search.trim() ? 'No locations match' : 'No other locations yet'"
        description="Pick a different yard, terminal, or customer. Add new ones from More → Customers & locations."
      />
    </template>
  </section>
</template>
