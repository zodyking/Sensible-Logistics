<script setup lang="ts">
import { RESET_TARGETS, type ResetCounts, type ResetTargetId } from '#shared/utils/reset-targets'

useHead({ title: 'Clear records' })

const { user } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')

const { data: features } = await useFetch('/api/features')
const resetUnlocked = Boolean(features.value?.unlocked?.includes('RESET'))
if (!resetUnlocked) {
  await navigateTo('/more', { replace: true })
}

const { data: counts, error, refresh } = await useFetch<ResetCounts>('/api/reset', {
  immediate: resetUnlocked,
})

const pending = ref<ResetTargetId | null>(null)
const busy = ref(false)
const flash = ref('')
const actionError = ref('')

const pendingTarget = computed(() => RESET_TARGETS.find(row => row.id === pending.value) ?? null)
const pendingCount = computed(() => {
  if (!pending.value || !counts.value) return 0
  return counts.value[pending.value]
})

function countFor(id: ResetTargetId) {
  return counts.value?.[id] ?? 0
}

function openConfirm(id: ResetTargetId) {
  if (busy.value || countFor(id) === 0) return
  pending.value = id
  actionError.value = ''
}

function closeConfirm() {
  if (busy.value) return
  pending.value = null
}

async function confirmClear() {
  const target = pending.value
  if (!target || busy.value) return
  busy.value = true
  actionError.value = ''
  flash.value = ''
  try {
    const result = await $fetch('/api/reset', {
      method: 'POST',
      body: { target },
    })
    counts.value = result.counts
    const label = pendingTarget.value?.label ?? 'Records'
    flash.value = `${label} cleared (${result.deleted}).`
    pending.value = null
    await refresh()
  }
  catch (err) {
    actionError.value = apiErrorMessage(err, 'Could not clear those records.')
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <section
    v-if="resetUnlocked"
    class="d-page"
  >
    <PageHeader
      eyebrow="System"
      title="Clear records"
      back-to="/more"
      back-label="More"
    />

    <p class="reset-lead">
      Each row clears one kind of company data. Your account, company, and settings stay.
    </p>

    <p
      v-if="flash"
      class="banner ok"
      role="status"
    >
      <span>{{ flash }}</span>
    </p>
    <p
      v-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ apiErrorMessage(error, 'Could not load record counts.') }}</span>
    </p>

    <div class="card rowlist">
      <div
        v-for="row in RESET_TARGETS"
        :key="row.id"
        class="row"
      >
        <div class="row-main">
          <b>{{ row.label }}</b>
          <small>{{ row.hint }}</small>
        </div>
        <div class="reset-end">
          <span class="reset-count">{{ countFor(row.id) }}</span>
          <button
            type="button"
            class="btn-danger reset-go"
            :disabled="busy || countFor(row.id) === 0"
            :aria-label="`Clear ${row.label}`"
            @click="openConfirm(row.id)"
          >
            Clear
          </button>
        </div>
      </div>
    </div>

    <BottomSheet
      :open="Boolean(pendingTarget)"
      :title="pendingTarget ? `Clear ${pendingTarget.label.toLowerCase()}?` : 'Clear records?'"
      @close="closeConfirm"
    >
      <p
        v-if="actionError"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ actionError }}</span>
      </p>
      <p class="text-sm text-[var(--color-ink-700)]">
        This permanently deletes {{ pendingCount }}
        {{ pendingTarget?.label.toLowerCase() }}. This cannot be undone.
      </p>
      <p
        v-if="pending === 'users'"
        class="text-sm text-[var(--color-ink-500)] mt-2"
      >
        Your account stays signed in. Other people in this company are removed.
      </p>
      <div class="sheet-actions">
        <button
          type="button"
          class="btn-cancel"
          :disabled="busy"
          @click="closeConfirm"
        >
          Keep records
        </button>
        <button
          type="button"
          class="btn-save danger"
          :disabled="busy"
          @click="confirmClear"
        >
          {{ busy ? 'Clearing…' : 'Clear' }}
        </button>
      </div>
    </BottomSheet>
  </section>
</template>
