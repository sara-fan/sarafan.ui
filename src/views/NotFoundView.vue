<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import UiButton from '../components/ui/UiButton.vue'
</script>

<template>
  <main class="page-container pending-view">
    <p class="page-kicker">
      ОШИБКА 404
    </p>
    <h1>Страница не найдена</h1>
    <p>Проверьте адрес или вернитесь на главную страницу.</p>
    <UiButton
      variant="primary"
      @click="$router.replace({ name: 'home' })"
    >
      На главную
    </UiButton>
  </main>
</template>
