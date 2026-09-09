<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { RouterLink } from 'vue-router'

import { BRAND_ICON_URL } from '../branding.js'

defineProps({ inverse: { type: Boolean, default: false } })
</script>

<template>
  <div
    class="brand-lockup"
    :class="{ 'brand-lockup--inverse': inverse }"
  >
    <RouterLink
      class="brand-lockup__home"
      :to="{ name: 'home' }"
      aria-label="Сарафан — главная"
    >
      <span class="brand-lockup__mark">
        <img
          :src="BRAND_ICON_URL"
          alt=""
          aria-hidden="true"
        >
      </span>
      <span class="brand-lockup__name">Сарафан</span>
    </RouterLink>
    <a
      class="brand-lockup__partner"
      href="https://gtc.express/"
      target="_blank"
      rel="noopener noreferrer"
    >Совместно с GTC</a>
  </div>
</template>
