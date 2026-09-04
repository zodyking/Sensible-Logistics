<script setup lang="ts">
import { SHIPCSX_REFERENCE, SHIPCSX_TERMINALS, pickShipcsxTerminal, shipcsxEquipmentParts } from '#shared/utils/csx-lookup'

const route = useRoute()
const { user } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')

const id = computed(() => String(route.params.id))
const { data, status, error } = await useFetch(() => `/api/containers/${id.value}`)

const initial = ref('')
const serial = ref('')
const reference = ref(SHIPCSX_REFERENCE)
const terminal = ref('')
const submitting = ref(false)
const formError = ref('')

useHead({ title: 'Check CSX' })

function applyContainerNumber(raw: string) {
  const parts = shipcsxEquipmentParts(raw)
  initial.value = parts?.initial ?? ''
  serial.value = parts?.number ?? ''
}

function applySuggestedTerminal(wanted?: string | null) {
  if (!wanted) {
    if (!terminal.value) terminal.value = pickShipcsxTerminal()
    return
  }
  terminal.value = pickShipcsxTerminal(wanted)
}

watch(() => data.value?.container, (container) => {
  if (!container || initial.value || serial.value) return
  applyContainerNumber(container.numberNormalized || container.number)
}, { immediate: true })

watch(
  () => data.value?.suggestedTerminal || data.value?.shipcsx?.terminalName,
  applySuggestedTerminal,
  { immediate: true },
)

onMounted(() => {
  if (data.value?.shipcsxCheck?.status === 'running') {
    navigateTo(`/containers/${id.value}`)
    return
  }
  applySuggestedTerminal(data.value?.suggestedTerminal)
})

const canSubmit = computed(() => {
  return Boolean(shipcsxEquipmentParts(`${initial.value}${serial.value}`) && terminal.value && !submitting.value)
})

async function submitCheck() {
  if (!canSubmit.value) return
  formError.value = ''
  submitting.value = true
  try {
    await $fetch(`/api/containers/${id.value}/shipcsx`, {
      method: 'POST',
      body: {
        terminal: terminal.value,
        equipmentNumber: `${initial.value}${serial.value}`,
        reference: reference.value.trim() || SHIPCSX_REFERENCE,
      },
      timeout: 20_000,
    })
    await navigateTo(`/containers/${id.value}`)
  }
  catch (err) {
    formError.value = apiErrorMessage(err, 'Could not start the ShipCSX check.')
    submitting.value = false
  }
}

const backTo = computed(() => `/containers/${id.value}`)
</script>

<template>
  <section :class="user?.role === 'ADMIN' ? '' : 'd-page'">
    <WizardNav
      title="Check CSX"
      back-label="Container"
      :back-to="backTo"
    />

    <p
      v-if="status === 'pending'"
      class="wiz-hint"
      role="status"
    >
      Loading container…
    </p>
    <p
      v-else-if="error"
      class="banner err"
      role="alert"
    >
      <span aria-hidden="true">✕</span>
      <span>{{ apiErrorMessage(error, 'Container not found.') }}</span>
    </p>

    <template v-else-if="data">
      <p
        v-if="formError"
        class="banner err"
        role="alert"
      >
        <span aria-hidden="true">✕</span>
        <span>{{ formError }}</span>
      </p>

      <span class="wiz-label">Container info</span>
      <div class="wiz-group">
        <div class="wiz-row">
          <label
            class="wiz-row-label"
            for="csx-initial"
          >Initial</label>
          <input
            id="csx-initial"
            v-model="initial"
            class="input mono"
            maxlength="4"
            autocapitalize="characters"
            autocomplete="off"
            spellcheck="false"
            placeholder="KOSU"
            aria-label="Trailer initial"
            @input="initial = initial.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4)"
          >
        </div>
        <div class="wiz-row">
          <label
            class="wiz-row-label"
            for="csx-number"
          >Number</label>
          <input
            id="csx-number"
            v-model="serial"
            class="input mono"
            maxlength="6"
            inputmode="numeric"
            autocomplete="off"
            spellcheck="false"
            placeholder="496803"
            aria-label="Trailer number"
            @input="serial = serial.replace(/\D/g, '').slice(0, 6)"
          >
        </div>
      </div>

      <span class="wiz-label">Reference</span>
      <div class="wiz-group">
        <div class="wiz-row">
          <label
            class="wiz-row-label"
            for="csx-reference"
          >Number</label>
          <input
            id="csx-reference"
            v-model="reference"
            class="input mono"
            maxlength="20"
            autocomplete="off"
            spellcheck="false"
            :placeholder="SHIPCSX_REFERENCE"
            aria-label="ShipCSX reference number"
          >
        </div>
      </div>
      <p class="wiz-hint">
        ShipCSX uses this to unlock extra details. Leave 0000 if you do not have a pickup number.
      </p>

      <span class="wiz-label">CSX location</span>
      <div class="wiz-group">
        <div class="wiz-row">
          <label
            class="wiz-row-label"
            for="csx-terminal"
          >Terminal</label>
          <select
            id="csx-terminal"
            v-model="terminal"
            class="input"
            aria-label="CSX terminal"
          >
            <option value="">
              Select terminal
            </option>
            <option
              v-for="name in SHIPCSX_TERMINALS"
              :key="name"
              :value="name"
            >
              {{ name }}
            </option>
          </select>
        </div>
      </div>
      <p class="wiz-hint">
        North Bergen, Little Ferry, South Kearny, Elizabeth, and Newark.
      </p>

      <div class="wiz-actions">
        <button
          type="button"
          class="wiz-next"
          :disabled="!canSubmit"
          @click="submitCheck"
        >
          {{ submitting ? 'Starting…' : 'Check' }}
        </button>
      </div>
    </template>
  </section>
</template>
