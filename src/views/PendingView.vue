<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import UiButton from '../components/ui/UiButton.vue'

defineProps({
  title: { type: String, required: true },
  copy: { type: String, required: true }
})
</script>

<template>
  <main class="page-container pending-view">
    <p class="page-kicker">
      САРАФАН
    </p>
    <h1>{{ title }}</h1>
    <p>{{ copy }}</p>
    <UiButton
      variant="secondary"
      @click="$router.push({ name: 'home' })"
    >
      На главную
    </UiButton>
  </main>
</template>
