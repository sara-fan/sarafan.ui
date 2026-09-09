<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, useId } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  label: { type: String, required: true },
  id: { type: String, default: '' },
  type: { type: String, default: 'text' },
  placeholder: { type: String, default: '' },
  hint: { type: String, default: '' },
  errors: { type: [Array, String], default: () => [] },
  required: { type: Boolean, default: false },
  readonly: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  multiline: { type: Boolean, default: false },
  rows: { type: Number, default: 4 }
})

const emit = defineEmits(['update:modelValue'])
const generatedId = useId()
const controlId = computed(() => props.id || `ui-field-${generatedId}`)
const errorText = computed(() => Array.isArray(props.errors) ? props.errors.join(' ') : props.errors)
const describedBy = computed(() => {
  if (errorText.value) return `${controlId.value}-error`
  if (props.hint) return `${controlId.value}-hint`
  return undefined
})
</script>

<template>
  <label
    class="ui-field"
    :class="{
      'ui-field--error': Boolean(errorText),
      'ui-field--readonly': readonly,
      'ui-field--disabled': disabled
    }"
  >
    <span class="ui-field__label">
      {{ label }}<span
        v-if="required"
        aria-hidden="true"
      > *</span>
    </span>
    <textarea
      v-if="multiline"
      :id="controlId"
      v-bind="$attrs"
      class="ui-field__control ui-field__control--multiline"
      :value="modelValue"
      :placeholder="placeholder"
      :rows="rows"
      :required="required"
      :readonly="readonly"
      :disabled="disabled"
      :aria-invalid="errorText ? 'true' : undefined"
      :aria-describedby="describedBy"
      @input="emit('update:modelValue', $event.target.value)"
    />
    <input
      v-else
      :id="controlId"
      v-bind="$attrs"
      class="ui-field__control"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :required="required"
      :readonly="readonly"
      :disabled="disabled"
      :aria-invalid="errorText ? 'true' : undefined"
      :aria-describedby="describedBy"
      @input="emit('update:modelValue', $event.target.value)"
    >
    <span
      v-if="errorText"
      :id="`${controlId}-error`"
      class="ui-field__message ui-field__message--error"
      role="alert"
    >{{ errorText }}</span>
    <span
      v-else-if="hint"
      :id="`${controlId}-hint`"
      class="ui-field__message"
    >{{ hint }}</span>
  </label>
</template>
