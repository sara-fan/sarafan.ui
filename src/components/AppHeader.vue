<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import BrandLockup from './BrandLockup.vue'

defineProps({
  authenticated: { type: Boolean, default: false },
  authenticationAvailable: { type: Boolean, default: true }
})
defineEmits(['authenticate', 'logout'])

const route = useRoute()
const menuOpen = ref(false)
watch(() => route.fullPath, () => { menuOpen.value = false })
</script>

<template>
  <header class="app-header">
    <BrandLockup
      class="app-header__brand"
    />
    <div class="app-header__actions">
      <nav
        v-if="authenticated"
        class="app-header__desktop-nav"
        aria-label="Основная навигация"
      >
        <RouterLink :to="{ name: 'orders' }">
          Мои заказы
        </RouterLink>
        <RouterLink :to="{ name: 'profile' }">
          Профиль
        </RouterLink>
        <button
          class="app-header__nav-action"
          type="button"
          @click="$emit('logout')"
        >
          Выйти
        </button>
      </nav>
      <button
        v-if="!authenticated"
        class="app-header__login"
        type="button"
        :disabled="!authenticationAvailable"
        @click="$emit('authenticate')"
      >
        Войти
      </button>
      <span
        class="global-support"
        aria-label="Поддержка недоступна в демонстрационной версии"
      >
        <span
          class="global-support__icon"
          aria-hidden="true"
        >?</span>
        <span>Поддержка</span>
      </span>
      <button
        v-if="authenticated"
        class="app-header__menu-button"
        type="button"
        :aria-expanded="menuOpen"
        aria-controls="mobile-navigation"
        aria-label="Открыть меню"
        @click="menuOpen = !menuOpen"
      >
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </button>
    </div>
    <nav
      v-if="authenticated && menuOpen"
      id="mobile-navigation"
      class="app-header__mobile-nav"
      aria-label="Мобильная навигация"
    >
      <RouterLink :to="{ name: 'home' }">
        Главная
      </RouterLink>
      <RouterLink :to="{ name: 'orders' }">
        Мои заказы
      </RouterLink>
      <RouterLink :to="{ name: 'profile' }">
        Профиль
      </RouterLink>
      <button
        type="button"
        @click="$emit('logout')"
      >
        Выйти
      </button>
    </nav>
  </header>
</template>
