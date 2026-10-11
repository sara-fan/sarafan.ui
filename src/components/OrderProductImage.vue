<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { ref, watch } from 'vue'
const props = defineProps({ src:{ type:String, default:null }, alt:{ type:String, default:'' } })
const failed = ref(false)
watch(() => props.src, () => { failed.value = false })
</script>

<template>
  <img
    v-if="src && !failed"
    :src="src"
    :alt="alt"
    referrerpolicy="no-referrer"
    @error="failed = true"
  >
  <span
    v-else
    role="img"
    aria-label="Изображение товара недоступно"
  >◇</span>
</template>
