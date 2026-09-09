<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import UiButton from './ui/UiButton.vue'

defineProps({ busy: { type: Boolean, default: false } })
defineEmits(['retry'])
</script>

<template>
  <main class="page-container pending-view service-unavailable-page">
    <p class="page-kicker">
      САРАФАН
    </p>
    <h1>Сервис недоступен</h1>
    <p>Сервис недоступен. Пожалуйста, повторите позже.</p>
    <UiButton
      variant="primary"
      :loading="busy"
      @click="$emit('retry')"
    >
      Повторить
    </UiButton>
  </main>
</template>
