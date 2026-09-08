<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

defineOptions({ inheritAttrs: false })

defineProps({
  variant: {
    type: String,
    default: 'secondary',
    validator: value => ['primary', 'secondary', 'quiet', 'danger'].includes(value)
  },
  disabled: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  block: { type: Boolean, default: false },
  type: { type: String, default: 'button' }
})
</script>

<template>
  <button
    v-bind="$attrs"
    :type="type"
    class="consent-button"
    :class="[`consent-button--${variant}`, { 'consent-button--block': block }]"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
  >
    <slot />
  </button>
</template>
