<script setup lang="ts">
import { formatChassisNumber, maskChassisInput } from '#shared/utils/iso6346'

const model = defineModel<string>({ default: '' })

withDefaults(defineProps<{
  id?: string
  disabled?: boolean
  invalid?: boolean
  describedby?: string
}>(), {
  id: undefined,
  disabled: false,
  invalid: false,
  describedby: undefined,
})

const display = computed({
  get: () => formatChassisNumber(model.value),
  set: (value: string) => {
    model.value = maskChassisInput(value)
  },
})
</script>

<template>
  <input
    :id="id"
    v-model="display"
    class="input mono"
    :class="{ invalid }"
    placeholder="TRAC 481029"
    autocapitalize="characters"
    autocomplete="off"
    spellcheck="false"
    maxlength="11"
    inputmode="text"
    :disabled="disabled"
    :readonly="disabled"
    :aria-describedby="describedby"
    aria-label="Chassis number"
  >
</template>
