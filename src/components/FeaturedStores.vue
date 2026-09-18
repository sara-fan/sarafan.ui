<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application
import { RouterLink } from 'vue-router'
import { usePublicStores } from '../stores/publicStores.js'
import FeaturedStoreRow from './FeaturedStoreRow.vue'
const catalogue = usePublicStores()
</script>
<template>
  <section
    v-if="catalogue.featured.items?.length"
    class="featured-stores"
    aria-labelledby="featured-stores-title"
    :aria-busy="catalogue.featured.loading"
  >
    <header class="featured-stores__header">
      <h2 id="featured-stores-title">
        Подборка магазинов США
      </h2>
    </header>
    <div class="featured-stores__list">
      <FeaturedStoreRow
        v-for="store in catalogue.featured.items"
        :key="store.id"
        :store="store"
      />
    </div>
    <footer class="featured-stores__footer">
      <RouterLink :to="{ name:'stores' }">
        Смотреть другие магазины в подборке
      </RouterLink>
    </footer>
  </section>
</template>
