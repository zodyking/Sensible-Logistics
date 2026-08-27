<script setup lang="ts">
import type { DocumentCategory } from '#shared/utils/domain'
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS } from '#shared/utils/domain'
import { formatContainerNumber } from '#shared/utils/iso6346'

definePageMeta({ layout: 'admin' })
useHead({ title: 'Documents · Management' })

/* OCR status vocabulary is page-local: domain.ts does not export it yet. */
type OcrStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'NOT_IMPLEMENTED'

const OCR_STATUS_LABELS: Record<OcrStatus, string> = {
  PENDING: 'OCR queued',
  RUNNING: 'OCR running',
  COMPLETED: 'OCR complete',
  FAILED: 'OCR failed',
  NOT_IMPLEMENTED: 'OCR not enabled',
}

const OCR_STATUS_CHIP: Record<OcrStatus, 'ok' | 'warn' | 'err' | 'transit' | 'idle'> = {
  PENDING: 'warn',
  RUNNING: 'transit',
  COMPLETED: 'ok',
  FAILED: 'err',
  NOT_IMPLEMENTED: 'idle',
}

/* --- Filters ------------------------------------------------------ */
const searchInput = ref('')
const q = ref('')
const category = ref<DocumentCategory | ''>('')

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchInput, (value) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    q.value = value.trim()
  }, 300)
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

const { data, status, error, refresh } = await useFetch('/api/admin/documents', {
  query: computed(() => ({
    q: q.value || undefined,
    category: category.value || undefined,
  })),
})

const rows = computed(() => data.value?.items ?? [])
const totals = computed(() => data.value?.totals ?? { total: 0, pendingOcr: 0 })
const hasFilters = computed(() => Boolean(q.value || category.value))

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB'] as const
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** index
  return `${index === 0 ? value : value.toFixed(1)} ${units[index]}`
}
</script>

<template>
  <div>
    <div class="a-head">
      <div>
        <span class="eyebrow">Records</span>
        <h1>Documents</h1>
      </div>
      <p class="text-sm text-[var(--color-ink-500)]">
        Every uploaded proof, searchable by file name and OCR-extracted text.
      </p>
    </div>

    <div class="a-toolbar">
      <label class="searchbar">
        <span class="sr-only">Search documents</span>
        <span aria-hidden="true">⌕</span>
        <input
          v-model="searchInput"
          type="search"
          placeholder="File name or extracted text…"
        >
      </label>
    </div>

    <div
      class="a-toolbar"
      role="group"
      aria-label="Document category filter"
    >
      <button
        class="fchip min-h-11"
        :class="{ on: category === '' }"
        :aria-pressed="category === ''"
        @click="category = ''"
      >
        All categories
      </button>
      <button
        v-for="value in DOCUMENT_CATEGORIES"
        :key="value"
        class="fchip min-h-11"
        :class="{ on: category === value }"
        :aria-pressed="category === value"
        @click="category = value"
      >
        {{ DOCUMENT_CATEGORY_LABELS[value] }}
      </button>
    </div>

    <div class="a-stats">
      <div class="a-stat">
        <small>Total documents</small>
        <b>{{ totals.total }}</b>
      </div>
      <div class="a-stat">
        <small>Awaiting OCR</small>
        <b>{{ totals.pendingOcr }}</b>
      </div>
    </div>

    <div
      v-if="status === 'pending'"
      class="card p-5"
      role="status"
    >
      <span class="sr-only">Loading documents…</span>
      <div
        class="space-y-3"
        aria-hidden="true"
      >
        <div class="h-4 w-1/3 animate-pulse rounded bg-[var(--color-paper-100)]" />
        <div class="h-4 w-2/3 animate-pulse rounded bg-[var(--color-paper-100)]" />
        <div class="h-4 w-1/2 animate-pulse rounded bg-[var(--color-paper-100)]" />
      </div>
    </div>

    <div
      v-else-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>
        <b>Could not load documents</b>
        {{ apiErrorMessage(error) }}
      </span>
      <button
        class="btn-ghost ml-auto"
        @click="refresh()"
      >
        Try again
      </button>
    </div>

    <div
      v-else-if="rows.length"
      class="table-wrap"
    >
      <table class="dtable">
        <caption class="sr-only">
          Documents matching the current filters
        </caption>
        <thead>
          <tr>
            <th scope="col">
              File
            </th>
            <th scope="col">
              Category
            </th>
            <th scope="col">
              Linked to
            </th>
            <th scope="col">
              OCR
            </th>
            <th scope="col">
              Size
            </th>
            <th scope="col">
              Uploaded by
            </th>
            <th scope="col">
              Created
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.id"
          >
            <td>
              <b class="block max-w-56 truncate">{{ row.fileName }}</b>
              <small class="text-[var(--color-ink-500)]">{{ row.mimeType ?? '—' }}</small>
            </td>
            <td>{{ DOCUMENT_CATEGORY_LABELS[row.category] }}</td>
            <td>
              <span
                v-if="row.containerNumber"
                class="mono block"
              >{{ formatContainerNumber(row.containerNumber) || row.containerNumber }}</span>
              <small
                v-if="row.tripReference"
                class="mono text-[var(--color-ink-500)]"
              >{{ row.tripReference }}</small>
              <span v-if="!row.containerNumber && !row.tripReference">—</span>
            </td>
            <td>
              <StatusChip
                :variant="OCR_STATUS_CHIP[row.ocrStatus]"
                :label="OCR_STATUS_LABELS[row.ocrStatus]"
              />
            </td>
            <td>{{ formatBytes(row.sizeBytes) }}</td>
            <td>{{ row.uploadedBy ?? '—' }}</td>
            <td>{{ formatRelative(row.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <EmptyState
      v-else-if="hasFilters"
      glyph="▤"
      title="No documents match"
      description="Try a different search term or category — OCR text is only searchable once processing completes."
    />

    <div
      v-else
      class="empty-state card"
    >
      <span
        class="glyph"
        aria-hidden="true"
      >▤</span>
      <b>No documents yet</b>
      <small>
        Documents attach to a container, trip, chassis, location or a specific custody event —
        never a loose shared folder. Uploads appear here once storage is wired up.
      </small>
      <ul class="mx-auto mt-5 grid max-w-2xl gap-2 text-left text-sm sm:grid-cols-2">
        <li class="rounded-[var(--radius-md)] border border-[var(--color-line-200)] p-3">
          <b class="!mb-1">Private object storage</b>
          <span class="text-[var(--color-ink-500)]">
            Files live in self-hosted SeaweedFS, reached over its S3 API — nothing leaves your infrastructure.
          </span>
        </li>
        <li class="rounded-[var(--radius-md)] border border-[var(--color-line-200)] p-3">
          <b class="!mb-1">Authenticated access</b>
          <span class="text-[var(--color-ink-500)]">
            Every download is authorised per user. There is never a public, guessable URL.
          </span>
        </li>
        <li class="rounded-[var(--radius-md)] border border-[var(--color-line-200)] p-3">
          <b class="!mb-1">Asynchronous OCR</b>
          <span class="text-[var(--color-ink-500)]">
            PaddleOCR PP-StructureV3 runs after upload, so drivers never wait on processing.
          </span>
        </li>
        <li class="rounded-[var(--radius-md)] border border-[var(--color-line-200)] p-3">
          <b class="!mb-1">Searchable text</b>
          <span class="text-[var(--color-ink-500)]">
            Extracted text is indexed, so every gate ticket and POD becomes findable from global search.
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>
