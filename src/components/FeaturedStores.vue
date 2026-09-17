<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application
import { RouterLink } from 'vue-router'
import { usePublicStores } from '../stores/publicStores.js'
import StoreCard from './StoreCard.vue'
const catalogue = usePublicStores()
</script>
<template>
  <section
    v-if="catalogue.featured.items?.length"
    class="featured-stores page-container"
    aria-labelledby="featured-stores-title"
    :aria-busy="catalogue.featured.loading"
  >
    <header class="stores-heading">
      <h2 id="featured-stores-title">
        Популярные магазины США
      </h2>
      <RouterLink :to="{ name:'stores' }">
        Все магазины
      </RouterLink>
    </header>
    <div class="store-grid">
      <StoreCard
        v-for="store in catalogue.featured.items"
        :key="store.id"
        :store="store"
      />
    </div>
  </section>
</template>
