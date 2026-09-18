<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import StoreImage from './StoreImage.vue'
defineProps({ store:{ type:Object, required:true } })
</script>

<template>
  <a
    class="featured-store-row"
    :href="store.officialUrl"
    target="_blank"
    rel="noopener noreferrer"
    :aria-label="`${store.name} — открыть сайт в новой вкладке`"
    :aria-describedby="`featured-store-description-${store.id}`"
  >
    <StoreImage
      class="featured-store-row__image"
      :name="store.name"
      :logo-url="store.logoUrl"
    />
    <span
      :id="`featured-store-description-${store.id}`"
      class="featured-store-row__description"
      :title="store.description"
    >{{ store.description }}</span>
  </a>
</template>
