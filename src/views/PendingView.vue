<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { useRouter } from 'vue-router'
import UiButton from '../components/ui/UiButton.vue'

const props = defineProps({
  title: { type: String, required: true },
  copy: { type: String, required: true },
  homeAction: { type: Function, default: null }
})
const router = useRouter()
function home() { return props.homeAction ? props.homeAction() : router.push({ name:'home' }) }
</script>

<template>
  <main class="page-container pending-view">
    <p class="page-kicker">
      САРАФАН
    </p>
    <h1>{{ title }}</h1>
    <p>{{ copy }}</p>
    <slot />
    <UiButton
      variant="secondary"
      @click="home"
    >
      На главную
    </UiButton>
  </main>
</template>
