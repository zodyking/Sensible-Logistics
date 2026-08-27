<script setup lang="ts">
import { formatContainerNumber, maskContainerInput } from '#shared/utils/iso6346'

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
  get: () => formatContainerNumber(model.value),
  set: (value: string) => {
    model.value = maskContainerInput(value)
  },
})
</script>

<template>
  <input
    :id="id"
    v-model="display"
    class="input mono"
    :class="{ invalid }"
    placeholder="BSIU 816924-7"
    autocapitalize="characters"
    autocomplete="off"
    spellcheck="false"
    maxlength="13"
    inputmode="text"
    :disabled="disabled"
    :readonly="disabled"
    :aria-describedby="describedby"
    aria-label="Container number"
  >
</template>
