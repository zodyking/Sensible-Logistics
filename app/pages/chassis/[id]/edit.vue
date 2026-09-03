<script setup lang="ts">
import {
  formatChassisNumber,
  isCompleteChassisNumber,
  maskChassisInput,
} from '#shared/utils/iso6346'

const route = useRoute()
const { user } = useUserSession()
setPageLayout(user.value?.role === 'ADMIN' ? 'admin' : 'default')
const id = computed(() => String(route.params.id))

const loading = ref(true)
const submitting = ref(false)
const errorMessage = ref('')
const locationName = ref('')

const form = reactive({
  number: '',
  provider: '',
  sizeCompatibility: '',
  licensePlate: '',
  notes: '',
  outOfService: false,
})

useHead({ title: 'Edit chassis' })

onMounted(async () => {
  try {
    const data = await $fetch<{
      chassis: {
        number: string
        provider: string | null
        sizeCompatibility: string | null
        licensePlate: string | null
        notes: string | null
        outOfService: boolean
      }
      currentLocation: { name: string } | null
    }>(`/api/chassis/${id.value}`)
    form.number = maskChassisInput(data.chassis.number)
    form.provider = data.chassis.provider ?? ''
    form.sizeCompatibility = data.chassis.sizeCompatibility ?? ''
    form.licensePlate = data.chassis.licensePlate ?? ''
    form.notes = data.chassis.notes ?? ''
    form.outOfService = Boolean(data.chassis.outOfService)
    locationName.value = data.currentLocation?.name ?? ''
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not load this chassis.')
  }
  finally {
    loading.value = false
  }
})

const numberOk = computed(() => isCompleteChassisNumber(form.number))
const canSave = computed(() => numberOk.value)

async function save() {
  if (submitting.value || !canSave.value) return
  errorMessage.value = ''
  submitting.value = true
  try {
    await $fetch(`/api/chassis/${id.value}`, {
      method: 'PATCH',
      body: {
        number: form.number,
        provider: form.provider.trim() || null,
        sizeCompatibility: form.sizeCompatibility.trim() || null,
        licensePlate: form.licensePlate.trim() || null,
        notes: form.notes.trim() || null,
        outOfService: form.outOfService,
      },
    })
    await navigateTo(`/chassis/${id.value}`)
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Could not save the chassis.')
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="d-page">
    <PageHeader
      eyebrow="Edit chassis"
      :title="loading ? 'Chassis' : (formatChassisNumber(form.number) || 'Chassis')"
      :back-to="`/chassis/${id}`"
      back-label="Chassis"
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
      Loading chassis…
    </div>

    <form
      v-else
      class="flex flex-col gap-4"
      @submit.prevent="save"
    >
      <div class="card p-4">
        <label
          class="field"
          for="edit-chassis-number"
        >
          <span>Chassis number</span>
          <ChassisNumberInput
            id="edit-chassis-number"
            v-model="form.number"
            :invalid="Boolean(form.number) && !numberOk"
          />
        </label>

        <label
          class="field"
          for="edit-chassis-provider"
        >
          <span>Provider</span>
          <input
            id="edit-chassis-provider"
            v-model="form.provider"
            class="input"
            placeholder="TRAC"
            autocomplete="off"
          >
        </label>

        <label
          class="field"
          for="edit-chassis-size"
        >
          <span>Size</span>
          <input
            id="edit-chassis-size"
            v-model="form.sizeCompatibility"
            class="input"
            placeholder="40 / 45"
            autocomplete="off"
          >
        </label>

        <label
          class="field"
          for="edit-chassis-plate"
        >
          <span>License plate</span>
          <input
            id="edit-chassis-plate"
            v-model="form.licensePlate"
            class="input mono"
            placeholder="ABC1234"
            autocapitalize="characters"
            autocomplete="off"
          >
        </label>

        <label
          class="field"
          for="edit-chassis-notes"
        >
          <span>Notes</span>
          <textarea
            id="edit-chassis-notes"
            v-model="form.notes"
            class="input"
            rows="3"
          />
        </label>

        <label class="yard-toggle !mb-0">
          <input
            v-model="form.outOfService"
            type="checkbox"
          >
          Out of service
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
