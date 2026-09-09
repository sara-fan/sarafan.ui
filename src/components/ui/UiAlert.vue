<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

defineProps({
  tone: {
    type: String,
    default: 'danger',
    validator: value => ['danger', 'success', 'info'].includes(value)
  },
  title: { type: String, default: '' }
})
</script>

<template>
  <div
    class="ui-alert"
    :class="`ui-alert--${tone}`"
    :role="tone === 'danger' ? 'alert' : 'status'"
  >
    <strong v-if="title">{{ title }}</strong>
    <div class="ui-alert__content">
      <slot />
    </div>
  </div>
</template>
