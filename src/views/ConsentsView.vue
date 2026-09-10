<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import ConsentCenter from '../components/ConsentCenter.vue'

defineProps({
  section: {
    type: String,
    default: 'auto',
    validator: value => ['auto', 'cookies', 'personal'].includes(value)
  }
})
</script>

<template>
  <ConsentCenter
    :key="section"
    mode="consents"
    :section="section"
  />
</template>
