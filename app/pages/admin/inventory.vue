<script setup lang="ts">
import { inventoryViewFromQuery, type InventoryView } from '#shared/utils/inventory-view'

definePageMeta({ layout: 'admin' })

const route = useRoute()
const view = computed(() => inventoryViewFromQuery(route.query.view))

useHead({
  title: computed(() => (
    view.value === 'containers'
      ? 'Inventory · Containers · Management'
      : 'Inventory · Locations · Management'
  )),
})

function setView(next: InventoryView) {
  if (view.value === next) return
  void navigateTo({
    path: '/admin/inventory',
    query: next === 'containers' ? { view: 'containers' } : {},
  }, { replace: true })
}
</script>

<template>
  <div>
    <div class="a-head">
      <div>
        <span class="eyebrow">Operations</span>
        <h1>Inventory</h1>
      </div>
      <div class="a-head-actions">
        <div
          class="view-toggle"
          role="tablist"
          aria-label="Inventory view"
        >
          <button
            type="button"
            role="tab"
            :aria-selected="view === 'locations'"
            :class="{ on: view === 'locations' }"
            @click="setView('locations')"
          >
            Locations
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="view === 'containers'"
            :class="{ on: view === 'containers' }"
            @click="setView('containers')"
          >
            Containers
          </button>
        </div>
        <NuxtLink
          v-if="view === 'locations'"
          to="/locations/new"
          class="btn-dark w-auto"
        >
          ＋ New location
        </NuxtLink>
      </div>
    </div>

    <AdminInventoryLocations v-if="view === 'locations'" />
    <AdminInventoryContainers v-else />
  </div>
</template>
