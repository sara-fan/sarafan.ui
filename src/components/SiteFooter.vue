<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import { useConsents } from '../stores/consents.js'
import BrandLockup from './BrandLockup.vue'

const { ops } = useConsents()
const documents = computed(() => ops.value?.kinds || [])
</script>

<template>
  <footer class="site-footer">
    <div class="site-footer__inner">
      <BrandLockup
        class="site-footer__brand"
        inverse
      />
      <nav
        class="site-footer__links"
        aria-label="Юридические документы"
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
      </nav>
    </div>
  </footer>
</template>
