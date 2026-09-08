<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

defineOptions({ inheritAttrs: false })

defineProps({
  modelValue: { type: Boolean, required: true },
  disabled: { type: Boolean, default: false },
  error: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <label
    class="consent-checkbox"
    :class="{ 'consent-checkbox--disabled': disabled, 'consent-checkbox--error': error }"
  >
    <input
      v-bind="$attrs"
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      :aria-invalid="error || undefined"
      @change="emit('update:modelValue', $event.target.checked)"
    >
    <span
      class="consent-checkbox__mark"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 16 16"
        focusable="false"
      >
        <path d="m3.25 8.1 3.05 3.05 6.45-6.45" />
      </svg>
    </span>
    <span class="consent-checkbox__content">
      <slot />
    </span>
  </label>
</template>
