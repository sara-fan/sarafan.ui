<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import { useConsents } from '../stores/consents.js'

const { ops } = useConsents()
const documents = computed(() => ops.value?.kinds || [])
</script>

<template>
  <footer class="site-footer">
    <div class="site-footer__inner">
      <RouterLink
        class="site-footer__brand"
        :to="{ name: 'home' }"
      >
        Сарафан
      </RouterLink>
      <nav
        class="site-footer__links"
        aria-label="Документы и партнёры"
      >
        <RouterLink
          v-for="document in documents"
          :key="document.value"
          :to="{ name: 'legal-document', params: { documentRef: document.routeAlias } }"
        >
          {{ document.name }}
        </RouterLink>
        <RouterLink :to="{ name: 'consents' }">
          Настройки куки
        </RouterLink>
        <a
          href="https://gtc.express/"
          target="_blank"
          rel="noopener noreferrer"
        >Совместно с GTC</a>
      </nav>
    </div>
  </footer>
</template>
