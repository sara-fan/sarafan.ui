<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  modelValue: { type: [Boolean, String, Number], required: true },
  kind: {
    type: String,
    default: 'checkbox',
    validator: value => ['checkbox', 'radio'].includes(value)
  },
  value: { type: [String, Number, Boolean], default: true },
  disabled: { type: Boolean, default: false },
  error: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue'])
const selected = computed(() => props.kind === 'checkbox'
  ? Boolean(props.modelValue)
  : props.modelValue === props.value)

function update(event) {
  emit('update:modelValue', props.kind === 'checkbox' ? event.target.checked : props.value)
}
</script>

<template>
  <label
    class="ui-selection"
    :class="[
      `ui-selection--${kind}`,
      { 'ui-selection--disabled': disabled, 'ui-selection--error': error }
    ]"
  >
    <input
      v-bind="$attrs"
      :type="kind"
      :checked="selected"
      :value="value"
      :disabled="disabled"
      :aria-invalid="error || undefined"
      @change="update"
    >
    <span
      class="ui-selection__mark"
      aria-hidden="true"
    />
    <span class="ui-selection__content"><slot /></span>
  </label>
</template>
