<script setup lang="ts">
import {
  CONTAINER_TYPE_LABELS,
  CONTAINER_TYPES,
  PICKUP_EQUIPMENT_SIZE_LABELS,
  PICKUP_EQUIPMENT_SIZES,
  TRIP_KIND_LABELS,
  pickupEquipmentSizeLabel,
} from '#shared/utils/domain'
import type { ContainerType, PickupEquipmentSize } from '#shared/utils/domain'
import {
  formatChassisNumber,
  formatContainerNumber,
  isCompleteChassisNumber,
  maskChassisInput,
  maskContainerInput,
  validateContainerNumber,
} from '#shared/utils/iso6346'
import {
  auditCardBackStage,
  auditCardClassifyReady,
  auditCardNextStage,
  auditCardNumbersReady,
  auditCardTitle,
} from '#shared/utils/location-audit'
import type {
  LocationAuditEquipmentDraft,
  LocationAuditEquipmentKind,
} from '#shared/utils/location-audit'

const draft = defineModel<LocationAuditEquipmentDraft>({ required: true })

withDefaults(defineProps<{
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

const title = computed(() => auditCardTitle(draft.value))
const backStage = computed(() => auditCardBackStage(draft.value))
const nextStage = computed(() => auditCardNextStage(draft.value))
const numbersReady = computed(() => auditCardNumbersReady(draft.value))

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

const summaryNumber = computed(() => {
  if (draft.value.kind === 'BARE_CHASSIS') {
    return formatChassisNumber(draft.value.chassisNumber) || draft.value.chassisNumber
  }
  return formatContainerNumber(draft.value.containerNumber) || draft.value.containerNumber
})

const summaryMeta = computed(() => {
  if (draft.value.kind === 'BARE_CHASSIS') return 'Bare chassis'
  const parts = [
    draft.value.containerType ? CONTAINER_TYPE_LABELS[draft.value.containerType] : null,
    draft.value.equipmentType ? pickupEquipmentSizeLabel(draft.value.equipmentType) : null,
    'Empty',
    draft.value.chassisNumber ? formatChassisNumber(draft.value.chassisNumber) : null,
  ]
  return parts.filter(Boolean).join(' · ')
})

function setContainerNumber(value: string) {
  draft.value = { ...draft.value, containerNumber: maskContainerInput(value) }
}

function setChassisNumber(value: string) {
  draft.value = { ...draft.value, chassisNumber: maskChassisInput(value) }
}

function goBack() {
  const stage = backStage.value
  if (!stage) return
  draft.value = { ...draft.value, stage }
}

function goNext() {
  const stage = nextStage.value
  if (!stage) return
  draft.value = { ...draft.value, stage }
}

function pickKind(kind: LocationAuditEquipmentKind) {
  draft.value = {
    ...draft.value,
    kind,
    stage: 'numbers',
    containerType: kind === 'CONTAINER' ? draft.value.containerType : null,
    equipmentType: kind === 'CONTAINER' ? draft.value.equipmentType : null,
  }
}

function pickType(type: ContainerType) {
  const next = { ...draft.value, containerType: type }
  draft.value = auditCardClassifyReady(next) ? { ...next, stage: 'done' } : next
}

function pickSize(size: PickupEquipmentSize) {
  const next = { ...draft.value, equipmentType: size }
  draft.value = auditCardClassifyReady(next) ? { ...next, stage: 'done' } : next
}
</script>

<template>
  <article class="audit-eq-card wiz-group">
    <header class="audit-eq-nav">
      <button
        v-if="backStage"
        type="button"
        class="audit-eq-back"
        @click="goBack"
      >
        <span aria-hidden="true">‹</span>
        Back
      </button>
      <span
        v-else
        class="audit-eq-back-spacer"
      />
      <b class="audit-eq-title">{{ title }}</b>
      <button
        v-if="canRemove"
        type="button"
        class="audit-eq-remove"
        :aria-label="`Remove ${title}`"
        @click="emit('remove')"
      >
        Remove
      </button>
      <span
        v-else
        class="audit-eq-back-spacer"
      />
    </header>

    <template v-if="draft.stage === 'kind'">
      <button
        type="button"
        class="wiz-pick"
        :aria-pressed="draft.kind === 'CONTAINER'"
        @click="pickKind('CONTAINER')"
      >
        <span class="wiz-pick-ico">
          <EquipmentIcon name="container" />
        </span>
        <span class="wiz-pick-main">
          <b>{{ TRIP_KIND_LABELS.CONTAINER }}</b>
          <small>Box and chassis</small>
        </span>
        <span
          class="wiz-chev"
          aria-hidden="true"
        >›</span>
      </button>
      <button
        type="button"
        class="wiz-pick"
        :aria-pressed="draft.kind === 'BARE_CHASSIS'"
        @click="pickKind('BARE_CHASSIS')"
      >
        <span class="wiz-pick-ico">
          <EquipmentIcon name="chassis" />
        </span>
        <span class="wiz-pick-main">
          <b>{{ TRIP_KIND_LABELS.BARE_CHASSIS }}</b>
          <small>Chassis only</small>
        </span>
        <span
          class="wiz-chev"
          aria-hidden="true"
        >›</span>
      </button>
    </template>

    <template v-else-if="draft.stage === 'done'">
      <button
        type="button"
        class="audit-eq-summary"
        @click="goBack"
      >
        <span class="wiz-pick-ico">
          <EquipmentIcon
            :name="draft.kind === 'BARE_CHASSIS' ? 'chassis' : 'container'"
            :size="36"
          />
        </span>
        <span class="wiz-pick-main">
          <b class="font-mono">{{ summaryNumber }}</b>
          <small>{{ summaryMeta }}</small>
        </span>
        <span class="audit-eq-edit">Edit</span>
      </button>
    </template>

    <template v-else>
      <div
        v-if="photo && !scanning"
        class="audit-eq-peek"
      >
        <ScanPhotoPeek :src="photo" />
      </div>

      <template v-if="draft.stage === 'numbers' && draft.kind === 'CONTAINER'">
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
          v-else
          class="audit-eq-hint"
        >
          Leave chassis blank if the box is sitting without one.
        </p>
      </template>

      <template v-else-if="draft.stage === 'numbers'">
        <div class="wiz-row">
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
      </template>

      <template v-else-if="draft.stage === 'classify'">
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
              @click="pickType(type)"
            >
              {{ CONTAINER_TYPE_LABELS[type] }}
            </button>
          </div>
        </div>
        <div class="audit-eq-section">
          <span class="audit-eq-section-label">Size</span>
          <div
            class="audit-eq-chips"
            role="group"
            aria-label="Container size"
          >
            <button
              v-for="size in PICKUP_EQUIPMENT_SIZES"
              :key="size"
              type="button"
              class="audit-eq-chip"
              :aria-pressed="draft.equipmentType === size"
              @click="pickSize(size)"
            >
              {{ PICKUP_EQUIPMENT_SIZE_LABELS[size] }}
            </button>
          </div>
        </div>
      </template>

      <DevicePhotoInput
        v-if="draft.stage === 'numbers'"
        class="audit-eq-scan"
        :label="photo ? 'Retake photo' : 'Scan with the camera'"
        :disabled="scanning"
        @photo="emit('photo', $event)"
      />
      <button
        v-if="draft.stage === 'numbers'"
        type="button"
        class="audit-eq-card-next"
        :disabled="!numbersReady"
        @click="goNext"
      >
        Next
      </button>
    </template>
  </article>
</template>
