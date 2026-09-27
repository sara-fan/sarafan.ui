<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import BrandLockup from './BrandLockup.vue'

defineProps({
  authenticated: { type: Boolean, default: false },
  storesAvailable: { type:Boolean, default:false },
  authenticationAvailable: { type: Boolean, default: true }
})
defineEmits(['authenticate', 'logout'])

const route = useRoute()
const activeSection = computed(() => route.meta.navigationSection)
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
        v-if="authenticated || storesAvailable"
        class="app-header__desktop-nav"
        aria-label="Основная навигация"
      >
        <RouterLink
          :to="{ name: 'home' }"
          :class="{ 'app-header__nav-link--active': activeSection === 'home' }"
          :aria-current="activeSection === 'home' ? 'page' : undefined"
        >
          Новый заказ
        </RouterLink>
        <RouterLink
          v-if="authenticated"
          :to="{ name: 'orders' }"
          :class="{ 'app-header__nav-link--active': activeSection === 'orders' }"
          :aria-current="activeSection === 'orders' ? 'page' : undefined"
        >
          Мои заказы
        </RouterLink>
        <RouterLink
          v-if="storesAvailable"
          :to="{ name: 'stores' }"
          :class="{ 'app-header__nav-link--active': activeSection === 'stores' }"
          :aria-current="activeSection === 'stores' ? 'page' : undefined"
        >
          Магазины
        </RouterLink>
        <RouterLink
          v-if="authenticated"
          :to="{ name: 'profile' }"
          :class="{ 'app-header__nav-link--active': activeSection === 'profile' }"
          :aria-current="activeSection === 'profile' ? 'page' : undefined"
        >
          Профиль
        </RouterLink>
        <button
          v-if="authenticated"
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
        v-if="authenticated || storesAvailable"
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
      v-if="(authenticated || storesAvailable) && menuOpen"
      id="mobile-navigation"
      class="app-header__mobile-nav"
      aria-label="Мобильная навигация"
    >
      <RouterLink
        :to="{ name: 'home' }"
        :class="{ 'app-header__nav-link--active': activeSection === 'home' }"
        :aria-current="activeSection === 'home' ? 'page' : undefined"
        @click="menuOpen = false"
      >
        Новый заказ
      </RouterLink>
      <RouterLink
        v-if="authenticated"
        :to="{ name: 'orders' }"
        :class="{ 'app-header__nav-link--active': activeSection === 'orders' }"
        :aria-current="activeSection === 'orders' ? 'page' : undefined"
        @click="menuOpen = false"
      >
        Мои заказы
      </RouterLink>
      <RouterLink
        v-if="storesAvailable"
        :to="{ name: 'stores' }"
        :class="{ 'app-header__nav-link--active': activeSection === 'stores' }"
        :aria-current="activeSection === 'stores' ? 'page' : undefined"
        @click="menuOpen = false"
      >
        Магазины
      </RouterLink>
      <RouterLink
        v-if="authenticated"
        :to="{ name: 'profile' }"
        :class="{ 'app-header__nav-link--active': activeSection === 'profile' }"
        :aria-current="activeSection === 'profile' ? 'page' : undefined"
        @click="menuOpen = false"
      >
        Профиль
      </RouterLink>
      <button
        v-if="authenticated"
        type="button"
        @click="$emit('logout')"
      >
        Выйти
      </button>
    </nav>
  </header>
</template>
