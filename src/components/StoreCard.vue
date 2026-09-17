<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application
defineProps({ store:{ type:Object, required:true } })
</script>

<template>
  <a
    class="store-card"
    :href="store.officialUrl"
    target="_blank"
    rel="noopener noreferrer"
    :aria-label="`${store.name} — открыть сайт в новой вкладке`"
  >
    <img
      class="store-card__logo"
      :src="store.logoUrl"
      alt=""
      loading="lazy"
    >
    <h3>{{ store.name }}</h3>
    <p>{{ store.description }}</p>
    <span
      class="store-card__external"
      aria-hidden="true"
    >↗</span>
  </a>
</template>
