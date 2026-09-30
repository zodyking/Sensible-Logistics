<script setup lang="ts">
import {
  CONTAINER_TYPE_LABELS,
  CONTAINER_TYPES,
  PICKUP_EQUIPMENT_SIZE_LABELS,
  PICKUP_EQUIPMENT_SIZES,
  TRIP_KIND_LABELS,
} from '#shared/utils/domain'
import {
  isCompleteChassisNumber,
  maskChassisInput,
  maskContainerInput,
  validateContainerNumber,
} from '#shared/utils/iso6346'
import type { LocationAuditEquipmentDraft } from '#shared/utils/location-audit'

const draft = defineModel<LocationAuditEquipmentDraft>({ required: true })

withDefaults(defineProps<{
  index: number
  canRemove?: boolean
  issue?: string
  photo?: string
  ocrMessage?: string
  scanning?: boolean
}>(), {
  canRemove: false,
  issue: '',
  photo: '',
  ocrMessage: '',
  scanning: false,
})

const emit = defineEmits<{
  remove: []
  photo: [dataUrl: string]
}>()

const containerInvalid = computed(() => {
  if (draft.value.kind !== 'CONTAINER') return false
  const value = draft.value.containerNumber
  if (!value || value.length < 11) return false
  return !validateContainerNumber(value).structureValid
})

const chassisInvalid = computed(() => {
  if (!draft.value.chassisNumber) return false
  return !isCompleteChassisNumber(draft.value.chassisNumber)
})

function setContainerNumber(value: string) {
  draft.value = { ...draft.value, containerNumber: maskContainerInput(value) }
}

function setChassisNumber(value: string) {
  draft.value = { ...draft.value, chassisNumber: maskChassisInput(value) }
}
</script>

<template>
  <article class="audit-eq-card wiz-group">
    <header class="audit-eq-head">
      <span class="audit-eq-kind">
        <EquipmentIcon
          :name="draft.kind === 'BARE_CHASSIS' ? 'chassis' : 'container'"
          :size="36"
        />
        <b>{{ TRIP_KIND_LABELS[draft.kind] }}</b>
        <small>{{ index + 1 }}</small>
      </span>
      <button
        v-if="canRemove"
        type="button"
        class="audit-eq-remove"
        :aria-label="`Remove ${TRIP_KIND_LABELS[draft.kind]} ${index + 1}`"
        @click="emit('remove')"
      >
        Remove
      </button>
    </header>

    <div
      v-if="photo && !scanning"
      class="audit-eq-peek"
    >
      <ScanPhotoPeek :src="photo" />
    </div>

    <template v-if="draft.kind === 'CONTAINER'">
      <div class="wiz-row">
        <label
          class="wiz-row-label"
          :for="`audit-container-${draft.id}`"
        >Number</label>
        <ContainerNumberInput
          :id="`audit-container-${draft.id}`"
          :model-value="draft.containerNumber"
          :invalid="containerInvalid"
          :describedby="issue ? `audit-issue-${draft.id}` : undefined"
          @update:model-value="setContainerNumber"
        />
      </div>
      <div class="wiz-row">
        <label
          class="wiz-row-label"
          :for="`audit-chassis-${draft.id}`"
        >Chassis</label>
        <ChassisNumberInput
          :id="`audit-chassis-${draft.id}`"
          :model-value="draft.chassisNumber"
          :invalid="chassisInvalid"
          @update:model-value="setChassisNumber"
        />
      </div>
      <div class="audit-eq-section">
        <span class="audit-eq-section-label">Type</span>
        <div
          class="audit-eq-chips"
          role="group"
          aria-label="Container type"
        >
          <button
            v-for="type in CONTAINER_TYPES"
            :key="type"
            type="button"
            class="audit-eq-chip"
            :aria-pressed="draft.containerType === type"
            @click="draft = { ...draft, containerType: type }"
          >
            {{ CONTAINER_TYPE_LABELS[type] }}
          </button>
        </div>
      </div>
      <div class="audit-eq-section">
        <span class="audit-eq-section-label">Size</span>
        <div
          class="audit-eq-chips two"
          role="group"
          aria-label="Container size"
        >
          <button
            v-for="size in PICKUP_EQUIPMENT_SIZES"
            :key="size"
            type="button"
            class="audit-eq-chip"
            :aria-pressed="draft.equipmentType === size"
            @click="draft = { ...draft, equipmentType: size }"
          >
            {{ PICKUP_EQUIPMENT_SIZE_LABELS[size] }}
          </button>
        </div>
      </div>
    </template>

    <div
      v-else
      class="wiz-row"
    >
      <label
        class="wiz-row-label"
        :for="`audit-chassis-${draft.id}`"
      >Number</label>
      <ChassisNumberInput
        :id="`audit-chassis-${draft.id}`"
        :model-value="draft.chassisNumber"
        :invalid="chassisInvalid"
        :describedby="issue ? `audit-issue-${draft.id}` : undefined"
        @update:model-value="setChassisNumber"
      />
    </div>

    <p
      v-if="issue && !scanning"
      :id="`audit-issue-${draft.id}`"
      class="audit-eq-issue"
    >
      {{ issue }}
    </p>
    <p
      v-else-if="ocrMessage && !scanning"
      class="audit-eq-issue"
    >
      {{ ocrMessage }}
    </p>
    <p
      v-else-if="draft.kind === 'CONTAINER'"
      class="audit-eq-hint"
    >
      Leave chassis blank if the box is sitting without one.
    </p>

    <DevicePhotoInput
      class="audit-eq-scan"
      :label="photo ? 'Retake photo' : 'Scan with the camera'"
      :disabled="scanning"
      @photo="emit('photo', $event)"
    />
  </article>
</template>
