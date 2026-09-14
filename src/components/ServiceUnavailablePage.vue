<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { SERVICE_UNAVAILABLE_MESSAGE } from '../errors/problem.js'
import UiButton from './ui/UiButton.vue'

defineProps({
  busy: { type: Boolean, default: false },
  message: { type: String, default: SERVICE_UNAVAILABLE_MESSAGE }
})
defineEmits(['retry'])
</script>

<template>
  <main class="page-container pending-view service-unavailable-page">
    <p class="page-kicker">
      САРАФАН
    </p>
    <h1>{{ message }}</h1>
    <UiButton
      variant="primary"
      :loading="busy"
      @click="$emit('retry')"
    >
      Повторить
    </UiButton>
  </main>
</template>
