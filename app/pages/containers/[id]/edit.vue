<script setup lang="ts">
import {
  formatContainerNumber,
  isCompleteChassisNumber,
  maskChassisInput,
  maskContainerInput,
  validateContainerNumber,
} from '#shared/utils/iso6346'

const route = useRoute()
const id = computed(() => String(route.params.id))

const loading = ref(true)
const submitting = ref(false)
const errorMessage = ref('')
const locationName = ref('')

const form = reactive({
  number: '',
  chassisNumber: '',
  isLoaded: true,
  sealNumber: '',
})

useHead({ title: 'Edit container' })

onMounted(async () => {
  try {
    const data = await $fetch<{
      container: {
        number: string
        isLoaded: boolean
        sealNumber: string | null
      }
      currentLocation: { name: string } | null
      currentChassis: { number: string } | null
    }>(`/api/containers/${id.value}`)
    form.number = maskContainerInput(data.container.number)
    form.chassisNumber = data.currentChassis?.number ? maskChassisInput(data.currentChassis.number) : ''
    form.isLoaded = Boolean(data.container.isLoaded)
    form.sealNumber = data.container.sealNumber ?? ''
    locationName.value = data.currentLocation?.name ?? ''
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not load this container.')
  }
  finally {
    loading.value = false
  }
})

const numberValidation = computed(() => validateContainerNumber(form.number))
const chassisOk = computed(() => !form.chassisNumber || isCompleteChassisNumber(form.chassisNumber))
const canSave = computed(() => {
  if (!numberValidation.value.structureValid || !chassisOk.value) return false
  if (form.isLoaded && !form.sealNumber.trim()) return false
  return true
})

async function save() {
  if (submitting.value || !canSave.value) return
  errorMessage.value = ''
  submitting.value = true
  try {
    await $fetch(`/api/containers/${id.value}`, {
      method: 'PATCH',
      body: {
        eventId: crypto.randomUUID(),
        number: form.number,
        chassisNumber: form.chassisNumber.trim() || null,
        isLoaded: form.isLoaded,
        sealNumber: form.isLoaded ? (form.sealNumber.trim() || null) : null,
      },
    })
    await navigateTo(`/containers/${id.value}`)
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not save the container.')
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="d-page">
    <PageHeader
      eyebrow="Edit container"
      :title="loading ? 'Container' : (formatContainerNumber(form.number) || 'Container')"
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

    <p
      v-if="locationName"
      class="mb-4 text-sm text-[var(--color-ink-500)]"
    >
      At {{ locationName }}
    </p>

    <div
      v-if="loading"
      class="card p-6 text-center text-sm text-[var(--color-ink-500)]"
      role="status"
    >
      Loading container…
    </div>

    <form
      v-else
      class="flex flex-col gap-4"
      @submit.prevent="save"
    >
      <div class="card p-4">
        <label
          class="field"
          for="edit-container-number"
        >
          <span>Container number</span>
          <ContainerNumberInput
            id="edit-container-number"
            v-model="form.number"
            :invalid="form.number.length >= 11 && !numberValidation.valid"
          />
        </label>

        <label
          class="field"
          for="edit-chassis-number"
        >
          <span>Chassis number</span>
          <ChassisNumberInput
            id="edit-chassis-number"
            v-model="form.chassisNumber"
            :invalid="Boolean(form.chassisNumber) && !chassisOk"
          />
          <small class="field-hint">Leave blank if there is no chassis.</small>
        </label>

        <span class="field-label">Load status</span>
        <div class="choice-grid cols-2 mb-4">
          <button
            type="button"
            class="choice-card"
            :aria-pressed="form.isLoaded"
            @click="form.isLoaded = true"
          >
            Loaded
            <small>Freight is on the box</small>
          </button>
          <button
            type="button"
            class="choice-card"
            :aria-pressed="!form.isLoaded"
            @click="form.isLoaded = false"
          >
            Empty
            <small>No freight</small>
          </button>
        </div>

        <label
          v-if="form.isLoaded"
          class="field !mb-0"
        >
          <span>Seal number</span>
          <input
            v-model="form.sealNumber"
            class="input mono"
            placeholder="004512"
            autocapitalize="characters"
            autocomplete="off"
          >
        </label>
      </div>

      <button
        class="btn-dark w-full"
        type="submit"
        :disabled="submitting || !canSave"
      >
        {{ submitting ? 'Saving…' : 'Save' }}
      </button>
    </form>
  </section>
</template>
