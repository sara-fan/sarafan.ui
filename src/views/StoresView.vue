<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StoreCard from '../components/StoreCard.vue'
import StoreCatalogueNotice from '../components/StoreCatalogueNotice.vue'
import { STORE_SORTS, storeSort, usePublicStores } from '../stores/publicStores.js'

const route = useRoute()
const router = useRouter()
const catalogue = usePublicStores()
const sort = computed(() => storeSort(route.query.sort))
watch(() => route.query.sort, value => {
  if (value !== undefined && value !== storeSort(value)) router.replace({ query:{ ...route.query, sort:'recommended' } })
}, { immediate:true })
watch(() => [catalogue.full.loading, catalogue.full.problem, catalogue.available.value], ([loading, problem, available]) => {
  if (!loading && !problem && available === false) router.replace({ name:'home' })
}, { immediate:true })
function changeSort(event) { return router.push({ query:{ ...route.query, sort:event.target.value } }) }
</script>
<template>
  <main class="stores-view page-container">
    <h1>Магазины США</h1>
    <StoreCatalogueNotice />
    <div class="stores-sort">
      <label for="store-sort">Сортировка</label>
      <select
        id="store-sort"
        :value="sort"
        @change="changeSort"
      >
        <option
          v-for="option in STORE_SORTS"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </option>
      </select>
    </div>
    <p
      v-if="catalogue.full.loading"
      role="status"
    >
      Загрузка магазинов…
    </p>
    <div
      class="store-grid"
      :aria-busy="catalogue.full.loading"
    >
      <StoreCard
        v-for="store in catalogue.full.items"
        :key="store.id"
        :store="store"
      />
    </div>
  </main>
</template>
