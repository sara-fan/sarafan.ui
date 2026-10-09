<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

defineProps({ delivery: { type: Object, default: null } })
</script>

<template>
  <section
    v-if="delivery"
    class="ui-form-section"
    aria-label="Сохранённая доставка"
  >
    <h2>Сохранённая доставка</h2>
    <p>{{ delivery.name }}</p>
    <p>{{ delivery.destination }}</p>
  </section>
</template>
