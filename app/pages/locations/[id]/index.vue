<script setup lang="ts">
import { CONTAINER_TYPE_LABELS, EQUIPMENT_TYPE_SHORT, LOCATION_TYPE_LABELS } from '#shared/utils/domain'
import { formatContainerNumber } from '#shared/utils/iso6346'
import { formatPhoneDisplay, toE164 } from '#shared/utils/phone'

const { user } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')

const route = useRoute()
const locationId = computed(() => String(route.params.id))

const { data, status, error } = await useFetch(() => `/api/locations/${locationId.value}`)

useHead({ title: () => data.value?.location.name ?? 'Location' })

const subtitle = computed(() => {
  const loc = data.value?.location
  if (!loc) return ''
  return [LOCATION_TYPE_LABELS[loc.type], loc.addressLine1, [loc.city, loc.state].filter(Boolean).join(', ')]
    .filter(Boolean)
    .join(' · ')
})
</script>

<template>
  <section :class="user?.role === 'ADMIN' ? '' : 'd-page'">
    <div
      v-if="status === 'pending'"
      class="card p-6 text-center text-sm text-[var(--color-ink-500)]"
      role="status"
    >
      Loading location…
    </div>

    <p
      v-else-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ apiErrorMessage(error, 'Location not found.') }}</span>
    </p>

    <template v-else-if="data">
      <PageHeader
        eyebrow="Location"
        :title="data.location.name"
        back-to="/locations"
        back-label="Locations"
      />
      <p class="mb-4 text-sm text-[var(--color-ink-500)]">
        {{ subtitle }}
      </p>
      <div
        v-if="data.location.mainPhone || data.location.contactPhone"
        class="card mb-4 p-4 text-sm"
      >
        <p
          v-if="data.location.mainPhone"
          class="mb-0"
        >
          <span class="eyebrow">Main number</span>
          <a
            class="mt-1 block font-semibold"
            :href="`tel:${toE164(data.location.mainPhone)}`"
          >{{ formatPhoneDisplay(data.location.mainPhone) }}</a>
        </p>
        <p
          v-if="data.location.contactPhone"
          class="mb-0"
          :class="data.location.mainPhone ? 'mt-3' : ''"
        >
          <span class="eyebrow">Contact</span>
          <a
            class="mt-1 block font-semibold"
            :href="`tel:${toE164(data.location.contactPhone)}`"
          >
            <template v-if="data.location.contactName">{{ data.location.contactName }} · </template>
            {{ formatPhoneDisplay(data.location.contactPhone) }}
          </a>
        </p>
      </div>

      <LocationTypeCounts
        class="mt-4"
        :counts="data.typeCounts"
        :occupancy="data.occupancy"
      />

      <NuxtLink
        :to="`/locations/${locationId}/add`"
        class="btn-dark mt-4 w-full"
      >
        Add a container
      </NuxtLink>

      <div class="section-label mt-6">
        <span>On site · {{ data.occupancy }}</span>
      </div>

      <div
        v-if="data.containers.length"
        class="card rowlist"
      >
        <NuxtLink
          v-for="item in data.containers"
          :key="item.id"
          :to="`/containers/${item.id}`"
          class="row"
        >
          <span
            class="type-swatch"
            :class="item.containerType"
            aria-hidden="true"
          />
          <span class="row-main">
            <b class="font-mono">{{ formatContainerNumber(item.number) || item.number }}</b>
            <small>
              {{ CONTAINER_TYPE_LABELS[item.containerType] }}
              · {{ EQUIPMENT_TYPE_SHORT[item.equipmentType] }}
              · {{ item.isLoaded ? 'Loaded' : 'Empty' }}
            </small>
          </span>
          <span
            class="row-end"
            aria-hidden="true"
          >›</span>
        </NuxtLink>
      </div>

      <EmptyState
        v-else
        glyph="▣"
        title="No containers on site"
        description="Drop off from a trip or add a box here."
      />
    </template>
  </section>
</template>
