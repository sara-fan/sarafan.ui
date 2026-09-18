<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application
import { ref, watch } from 'vue'

const props = defineProps({ name:{ type:String, required:true }, logoUrl:{ type:String, required:true } })
const failed = ref(false)
watch(() => props.logoUrl, () => { failed.value = false })
</script>

<template>
  <span
    class="store-image"
    role="img"
    :aria-label="failed ? `Изображение магазина ${name} недоступно` : `Изображение магазина ${name}`"
  >
    <img
      v-if="!failed"
      :src="logoUrl"
      alt=""
      loading="lazy"
      @error="failed = true"
    >
    <span
      v-else
      class="store-image__unavailable"
      aria-hidden="true"
    >Изображение недоступно</span>
  </span>
</template>
