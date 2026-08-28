<script setup lang="ts">
import { LOCATION_GLYPH, LOCATION_TYPE_LABELS } from '#shared/utils/domain'
import { formatPhoneDisplay } from '#shared/utils/phone'

useHead({ title: 'Location/Customer Manager' })

const search = ref('')
const debounced = ref('')
const pendingDelete = ref<{ id: string, name: string, occupancy: number } | null>(null)
const deleting = ref(false)
const deleteError = ref('')

let debounceTimer: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounced.value = value
  }, 300)
})

onBeforeUnmount(() => {
  clearTimeout(debounceTimer)
})

const { data, status, error, refresh } = await useFetch('/api/locations', {
  query: computed(() => ({ q: debounced.value || undefined, limit: 100 })),
})

function addressLine(item: {
  type: keyof typeof LOCATION_TYPE_LABELS
  addressLine1: string | null
  city: string | null
}) {
  const bits = [LOCATION_TYPE_LABELS[item.type]]
  if (item.addressLine1) bits.push(item.addressLine1)
  if (item.city) bits.push(item.city)
  return bits.join(' · ')
}

function askDelete(item: { id: string, name: string, occupancy: number }) {
  pendingDelete.value = item
  deleteError.value = ''
}

function closeDelete() {
  if (deleting.value) return
  pendingDelete.value = null
  deleteError.value = ''
}

async function confirmDelete() {
  if (!pendingDelete.value) return
  deleting.value = true
  deleteError.value = ''
  try {
    await $fetch(`/api/locations/${pendingDelete.value.id}`, { method: 'DELETE' })
    pendingDelete.value = null
    await refresh()
  }
  catch (err) {
    deleteError.value = apiErrorMessage(err, 'Could not delete that location.')
  }
  finally {
    deleting.value = false
  }
}
</script>

<template>
  <section class="d-page">
    <PageHeader
      eyebrow="Directory"
      title="Location/Customer Manager"
      back-to="/more"
      back-label="More"
    />
    <p class="mb-4 text-sm text-[var(--color-ink-500)]">
      Add and remove yards, terminals, and customers. Pickup and drop-off only select from this list.
    </p>

    <div class="searchbar">
      ⌕
      <input
        v-model="search"
        type="search"
        placeholder="Search location or customer…"
        aria-label="Search locations"
      >
    </div>

    <NuxtLink
      :to="{ path: '/locations/new', query: { returnTo: '/more/locations' } }"
      class="btn-dark mb-4 w-full"
    >
      Add a location
    </NuxtLink>

    <div
      v-if="status === 'pending'"
      class="card p-6 text-center text-sm text-[var(--color-ink-500)]"
      role="status"
    >
      Loading locations…
    </div>

    <p
      v-else-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ apiErrorMessage(error) }}</span>
    </p>

    <div
      v-else-if="data?.items.length"
      class="card rowlist"
    >
      <div
        v-for="item in data.items"
        :key="item.id"
        class="row"
      >
        <NuxtLink
          :to="`/locations/${item.id}`"
          class="mgr-link"
        >
          <span
            class="row-ico"
            aria-hidden="true"
          >{{ LOCATION_GLYPH[item.type] }}</span>
          <span class="row-main">
            <b>{{ item.name }}</b>
            <small>{{ addressLine(item) }}</small>
            <small
              v-if="item.mainPhone"
              class="block"
            >
              Main {{ formatPhoneDisplay(item.mainPhone) }}
            </small>
            <small v-if="item.occupancy > 0">
              {{ item.occupancy }} on site
            </small>
          </span>
        </NuxtLink>
        <button
          type="button"
          class="mgr-del"
          :aria-label="`Delete ${item.name}`"
          @click="askDelete(item)"
        >
          Delete
        </button>
      </div>
    </div>

    <EmptyState
      v-else
      glyph="◫"
      title="No locations yet"
      description="Add a yard, terminal, or customer. Every driver will be able to select it on pickup and drop-off."
    >
      <NuxtLink
        :to="{ path: '/locations/new', query: { returnTo: '/more/locations' } }"
        class="btn-ghost"
      >
        Add a location
      </NuxtLink>
    </EmptyState>

    <BottomSheet
      :open="Boolean(pendingDelete)"
      title="Delete location"
      @close="closeDelete"
    >
      <p
        v-if="deleteError"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ deleteError }}</span>
      </p>
      <p class="text-sm text-[var(--color-ink-700)]">
        Remove
        <b>{{ pendingDelete?.name }}</b>
        from the company list? Drivers will no longer see it on pickup or drop-off.
      </p>
      <p
        v-if="pendingDelete && pendingDelete.occupancy > 0"
        class="note err mt-3"
      >
        {{ pendingDelete.occupancy }} container{{ pendingDelete.occupancy === 1 ? '' : 's' }} still on site. Move or drop them off first.
      </p>
      <div class="sheet-actions">
        <button
          type="button"
          class="btn-ghost"
          :disabled="deleting"
          @click="closeDelete"
        >
          Keep
        </button>
        <button
          type="button"
          class="btn-danger"
          :disabled="deleting || (pendingDelete?.occupancy ?? 0) > 0"
          @click="confirmDelete"
        >
          {{ deleting ? 'Deleting…' : 'Delete' }}
        </button>
      </div>
    </BottomSheet>
  </section>
</template>
