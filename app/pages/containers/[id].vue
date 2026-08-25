<script setup lang="ts">
import { ACTIVE_POOL_CHIP, ACTIVE_POOL_LABELS, CONTAINER_TYPE_LABELS, DOCUMENT_CATEGORY_LABELS, EQUIPMENT_TYPE_LABELS } from '#shared/utils/domain'

const route = useRoute()
const { data, status, error } = await useFetch(() => `/api/containers/${route.params.id}`)

useHead({ title: () => data.value?.container.number ?? 'Container' })

/** Handling flags shown as chips — each carries a text label, not just colour. */
const flags = computed(() => {
  const c = data.value?.container
  if (!c) return []
  return [
    c.isReefer && { label: 'Reefer', variant: 'transit' as const },
    c.isHazmat && { label: 'Hazmat', variant: 'err' as const },
    c.isOverweight && { label: 'Overweight', variant: 'warn' as const },
    c.isDamaged && { label: 'Damaged', variant: 'err' as const },
    c.customsHold && { label: 'Customs hold', variant: 'err' as const },
    c.isUrgent && { label: 'Urgent', variant: 'warn' as const },
    c.doNotMove && { label: 'Do not move', variant: 'err' as const },
  ].filter(Boolean) as Array<{ label: string, variant: 'transit' | 'err' | 'warn' }>
})
</script>

<template>
  <section class="d-page">
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
      <PageHeader
        eyebrow="Container record"
        :title="data.container.number"
        back-to="/containers"
        back-label="Containers"
      />

      <div class="mb-4 flex flex-wrap gap-2">
        <StatusChip
          :variant="ACTIVE_POOL_CHIP[data.container.activePoolState]"
          :label="ACTIVE_POOL_LABELS[data.container.activePoolState]"
        />
        <StatusChip
          :variant="data.container.isLoaded ? 'ok' : 'idle'"
          :label="data.container.isLoaded ? 'Loaded' : 'Empty'"
        />
        <StatusChip
          plain
          variant="idle"
          :label="EQUIPMENT_TYPE_LABELS[data.container.equipmentType]"
        />
        <StatusChip
          plain
          variant="idle"
          :label="CONTAINER_TYPE_LABELS[data.container.containerType]"
        />
        <StatusChip
          v-if="!data.container.checkDigitValid"
          variant="warn"
          label="Check digit failed"
        />
        <StatusChip
          v-for="flag in flags"
          :key="flag.label"
          :variant="flag.variant"
          :label="flag.label"
        />
      </div>

      <!-- ── Current state ───────────────────────────────────── -->
      <div class="card p-4">
        <span class="eyebrow">Current state</span>
        <dl class="mt-3 grid grid-cols-2 gap-x-3 gap-y-4">
          <div>
            <dt class="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-400)]">
              Location
            </dt>
            <dd class="text-sm font-semibold">
              {{ data.currentLocation?.name ?? 'In transit' }}
            </dd>
          </div>
          <div>
            <dt class="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-400)]">
              Driver
            </dt>
            <dd class="text-sm font-semibold">
              {{ data.currentDriver?.name ?? 'Unassigned' }}
            </dd>
          </div>
          <div>
            <dt class="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-400)]">
              Chassis
            </dt>
            <dd class="mono text-sm font-semibold">
              {{ data.currentChassis?.number ?? 'None' }}
            </dd>
          </div>
          <div>
            <dt class="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-400)]">
              Seal
            </dt>
            <dd class="mono text-sm font-semibold">
              {{ data.container.sealNumber ?? '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-400)]">
              Last activity
            </dt>
            <dd class="text-sm font-semibold">
              {{ formatRelative(data.container.lastActivityAt) }}
            </dd>
          </div>
          <div>
            <dt class="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-400)]">
              Last free day
            </dt>
            <dd class="text-sm font-semibold">
              {{ data.container.lastFreeDay ?? 'Not recorded' }}
            </dd>
          </div>
        </dl>

        <p
          v-if="data.placement"
          class="banner info mt-4 mb-0"
        >
          <span aria-hidden="true">▸</span>
          <span>
            <b>Yard position recorded</b>
            {{ data.placement.slotCode ? `Slot ${data.placement.slotCode} · ` : '' }}
            x {{ data.placement.x }}, y {{ data.placement.y }}, {{ data.placement.rotation }}°
          </span>
        </p>
      </div>

      <!-- ── Documents ───────────────────────────────────────── -->
      <div class="section-label">
        <span>Documents &amp; evidence</span>
      </div>

      <div
        v-if="data.documents.length"
        class="card rowlist"
      >
        <div
          v-for="doc in data.documents"
          :key="doc.id"
          class="row"
        >
          <span
            class="row-ico"
            aria-hidden="true"
          >▤</span>
          <span class="row-main">
            <b>{{ doc.fileName }}</b>
            <small>{{ DOCUMENT_CATEGORY_LABELS[doc.category] }} · {{ formatRelative(doc.createdAt) }}</small>
          </span>
        </div>
      </div>

      <EmptyState
        v-else
        glyph="▤"
        title="No documents attached"
        description="EIRs, PODs and photos link to the exact pickup or drop-off event once object storage is deployed."
      />

      <!-- ── Custody history ─────────────────────────────────── -->
      <div class="section-label">
        <span>Custody history</span>
        <span class="!normal-case !tracking-normal font-normal">{{ data.timeline.length }} events</span>
      </div>

      <div
        v-if="data.timeline.length"
        class="card"
      >
        <EventTimeline :entries="data.timeline" />
      </div>

      <EmptyState
        v-else
        glyph="⇄"
        title="No events recorded"
      />
    </template>
  </section>
</template>
