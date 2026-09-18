<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StoreCard from '../components/StoreCard.vue'
import StoreCatalogueNotice from '../components/StoreCatalogueNotice.vue'
import { STORE_SEARCH_MAX_LENGTH, STORE_SORTS, storeSearch, storeSort, usePublicStores } from '../stores/publicStores.js'

const route = useRoute()
const router = useRouter()
const catalogue = usePublicStores()
const sort = computed(() => storeSort(route.query.sort))
const search = ref(storeSearch(route.query.search))
let searchTimer = null
function clearSearchTimer() {
  if (searchTimer) globalThis.clearTimeout(searchTimer)
  searchTimer = null
}
watch(() => [route.query.sort, route.query.search], ([rawSort, rawSearch]) => {
  clearSearchTimer()
  const normalizedSort = storeSort(rawSort)
  const normalizedSearch = storeSearch(rawSearch)
  search.value = normalizedSearch
  const invalidSort = rawSort !== undefined && (Array.isArray(rawSort) || rawSort !== normalizedSort)
  const invalidSearch = rawSearch !== undefined && (Array.isArray(rawSearch) || rawSearch !== normalizedSearch)
  if (!invalidSort && !invalidSearch) return
  const query = { ...route.query }
  if (invalidSort) query.sort = normalizedSort
  if (normalizedSearch) query.search = normalizedSearch
  else delete query.search
  router.replace({ query })
}, { immediate:true })
watch(() => [catalogue.availability.loading, catalogue.availability.problem, catalogue.available.value], ([loading, problem, available]) => {
  if (!loading && !problem && available === false) router.replace({ name:'home' })
}, { immediate:true })
function changeSort(event) { return router.push({ query:{ ...route.query, sort:event.target.value } }) }
function changeSearch(event) {
  search.value = String(event.target.value).slice(0, STORE_SEARCH_MAX_LENGTH)
  if (storeSearch(search.value) !== storeSearch(route.query.search)) catalogue.invalidate()
  clearSearchTimer()
  searchTimer = globalThis.setTimeout(() => {
    searchTimer = null
    const normalized = storeSearch(search.value)
    if (normalized === storeSearch(route.query.search)) { search.value = normalized; return }
    const query = { ...route.query }
    if (normalized) query.search = normalized
    else delete query.search
    router.push({ query })
  }, 300)
}
onBeforeUnmount(clearSearchTimer)
</script>
<template>
  <main class="stores-view page-container">
    <h1>Магазины США</h1>
    <StoreCatalogueNotice />
    <div class="stores-controls">
      <div class="stores-search">
        <span
          class="stores-search__icon"
          aria-hidden="true"
        />
        <label for="store-search">Поиск по названию</label>
        <input
          id="store-search"
          type="search"
          :maxlength="STORE_SEARCH_MAX_LENGTH"
          :value="search"
          @input="changeSearch"
        >
      </div>
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
    </div>
    <p
      v-if="catalogue.full.loading"
      role="status"
    >
      Загрузка магазинов…
    </p>
    <div
      class="store-list"
      role="list"
      :aria-busy="catalogue.full.loading"
    >
      <StoreCard
        v-for="store in catalogue.full.items"
        :key="store.id"
        :store="store"
      />
    </div>
    <p
      v-if="!catalogue.full.loading && !catalogue.full.problem && catalogue.full.items?.length === 0 && catalogue.full.search"
      class="stores-empty-search"
      role="status"
    >
      По вашему запросу магазины не найдены.
    </p>
  </main>
</template>
