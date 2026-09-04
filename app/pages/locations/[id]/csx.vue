<script setup lang="ts">
import { formatContainerNumber, maskContainerInput } from '#shared/utils/iso6346'
import type { CsxListPair } from '#shared/utils/csx-list-parse'

const { user } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')

const route = useRoute()
const locationId = computed(() => String(route.params.id))

const { data, error } = await useFetch(() => `/api/locations/${locationId.value}`)
useHead({ title: () => `CSX list · ${data.value?.location.name ?? 'Location'}` })

const rows = ref<Array<{ containerNumber: string, pickupNumber: string }>>([
  { containerNumber: '', pickupNumber: '' },
])
const proposed = ref<CsxListPair[]>([])
const leftover = ref<{ containers: string[], pickups: string[] }>({ containers: [], pickups: [] })
const reading = ref(false)
const saving = ref(false)
const actionError = ref('')
const pasteText = ref('')

function addRow() {
  rows.value.push({ containerNumber: '', pickupNumber: '' })
}

function applyProposed() {
  const next = proposed.value.map(pair => ({
    containerNumber: maskContainerInput(pair.containerNumber),
    pickupNumber: pair.pickupNumber,
  }))
  rows.value = next.length ? next : [{ containerNumber: '', pickupNumber: '' }]
}

async function parsePhoto(dataUrl: string) {
  reading.value = true
  actionError.value = ''
  try {
    const result = await $fetch(`/api/locations/${locationId.value}/csx-releases/parse`, {
      method: 'POST',
      body: { image: dataUrl },
    })
    proposed.value = result.pairs
    leftover.value = { containers: result.leftoverContainers, pickups: result.leftoverPickups }
    if (result.pairs.length) applyProposed()
    else actionError.value = 'No container and pickup pairs could be read. Type them below.'
  }
  catch (err) {
    actionError.value = apiErrorMessage(err, 'Could not read that list.')
  }
  finally {
    reading.value = false
  }
}

async function parsePaste() {
  if (!pasteText.value.trim()) return
  reading.value = true
  actionError.value = ''
  try {
    const result = await $fetch(`/api/locations/${locationId.value}/csx-releases/parse`, {
      method: 'POST',
      body: { text: pasteText.value },
    })
    proposed.value = result.pairs
    leftover.value = { containers: result.leftoverContainers, pickups: result.leftoverPickups }
    if (result.pairs.length) applyProposed()
    else actionError.value = 'No pairs found in that text.'
  }
  catch (err) {
    actionError.value = apiErrorMessage(err, 'Could not parse that list.')
  }
  finally {
    reading.value = false
  }
}

async function save() {
  const ready = rows.value
    .map(row => ({
      containerNumber: row.containerNumber.trim(),
      pickupNumber: row.pickupNumber.trim(),
    }))
    .filter(row => row.containerNumber && row.pickupNumber)
  if (!ready.length) {
    actionError.value = 'Add at least one container and pickup number.'
    return
  }
  saving.value = true
  actionError.value = ''
  try {
    await $fetch(`/api/locations/${locationId.value}/csx-releases`, {
      method: 'POST',
      body: {
        source: proposed.value.length ? 'OCR' : 'MANUAL',
        rows: ready,
      },
    })
    await navigateTo(`/locations/${locationId.value}`)
  }
  catch (err) {
    actionError.value = apiErrorMessage(err, 'Could not save the pickup list.')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <section :class="user?.role === 'ADMIN' ? '' : 'd-page'">
    <PageHeader
      eyebrow="CSX empties"
      :title="data?.location.name ?? 'Location'"
      :back-to="`/locations/${locationId}`"
      back-label="Location"
    />

    <p
      v-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ apiErrorMessage(error, 'Location not found.') }}</span>
    </p>

    <p class="mb-4 text-sm text-[var(--color-ink-500)]">
      These are empties to pick up at this terminal — not boxes sitting on the yard.
      Review every pair before saving.
    </p>

    <p
      v-if="actionError"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ actionError }}</span>
    </p>

    <DevicePhotoInput
      class="btn-ghost mb-3 w-full"
      :label="reading ? 'Reading list…' : 'Photo of the list'"
      :disabled="reading"
      @photo="parsePhoto"
    />

    <label class="field mb-4">
      <span>Or paste the list</span>
      <textarea
        v-model="pasteText"
        class="textarea"
        rows="4"
        placeholder="KOSU495338  NBDLNQ"
        @change="parsePaste"
      />
    </label>

    <p
      v-if="proposed.some(pair => pair.confidence === 'guess')"
      class="banner info mb-4"
    >
      <span aria-hidden="true">▸</span>
      <span>Some pairs were guessed from leftover numbers. Check them before saving.</span>
    </p>

    <div class="card p-4">
      <div
        v-for="(row, index) in rows"
        :key="index"
        class="mb-3 grid grid-cols-2 gap-3"
      >
        <label class="field !mb-0">
          <span>Container</span>
          <input
            v-model="row.containerNumber"
            class="input mono"
            autocomplete="off"
            autocapitalize="characters"
            @input="row.containerNumber = maskContainerInput(row.containerNumber)"
          >
        </label>
        <label class="field !mb-0">
          <span>Pickup #</span>
          <input
            v-model="row.pickupNumber"
            class="input mono"
            autocomplete="off"
          >
        </label>
      </div>
      <button
        type="button"
        class="btn-ghost w-full"
        @click="addRow"
      >
        Add another
      </button>
    </div>

    <p
      v-if="leftover.containers.length || leftover.pickups.length"
      class="mt-3 text-xs text-[var(--color-ink-500)]"
    >
      Unmatched:
      {{ leftover.containers.map(n => formatContainerNumber(n) || n).join(', ') }}
      {{ leftover.pickups.join(', ') }}
    </p>

    <button
      type="button"
      class="btn-primary-action mt-4 w-full"
      :disabled="saving || reading"
      @click="save"
    >
      {{ saving ? 'Saving…' : 'Save pickup list' }}
    </button>
  </section>
</template>
