<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { usePublicStores } from '../stores/publicStores.js'
import { presentProblem } from '../errors/problem.js'
import UiAlert from './ui/UiAlert.vue'
import UiButton from './ui/UiButton.vue'

const route = useRoute()
const catalogue = usePublicStores()
const home = computed(() => route.name === 'home')
const problem = computed(() => catalogue.full.problem || (home.value && catalogue.featured.problem))
const busy = computed(() => catalogue.full.loading || (home.value && catalogue.featured.loading))
</script>
<template>
  <UiAlert
    v-if="problem"
    class="store-catalogue-notice"
  >
    <p>{{ presentProblem(problem) }}</p>
    <UiButton
      :loading="busy"
      variant="secondary"
      @click="catalogue.refresh(catalogue.full.sort, home)"
    >
      Повторить загрузку магазинов
    </UiButton>
  </UiAlert>
</template>
