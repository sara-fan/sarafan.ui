<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

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
    <img
      class="featured-store-row__logo"
      :src="store.logoUrl"
      alt=""
      loading="lazy"
    >
    <span class="featured-store-row__name">{{ store.name }}</span>
    <span
      :id="`featured-store-description-${store.id}`"
      class="featured-store-row__tooltip"
      role="tooltip"
    >{{ store.description }}</span>
  </a>
</template>
