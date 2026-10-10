<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

defineProps({ title: { type: String, required: true } })
</script>

<template>
  <section
    class="ui-panel"
    :aria-label="title"
  >
    <header class="ui-panel__heading">
      <h2 class="ui-section-title">
        {{ title }}
      </h2>
    </header>
    <slot />
  </section>
</template>
