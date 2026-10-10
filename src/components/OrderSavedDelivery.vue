<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import OrderDeliveryEstimate from './OrderDeliveryEstimate.vue'

defineProps({
  delivery: { type: Object, default: null },
  estimate: { type: Object, default: null },
  panel: { type: Boolean, default: false }
})
</script>

<template>
  <section
    v-if="delivery || estimate"
    :class="panel ? 'order-review-card order-delivery-panel' : 'ui-form-section'"
    aria-label="Доставка"
  >
    <div :class="panel ? 'order-review-card__heading' : undefined">
      <h2 :class="{ 'ui-section-title': panel }">
        Доставка
      </h2>
    </div>
    <template v-if="delivery">
      <p>{{ delivery.name }}</p>
      <p>{{ delivery.destination }}</p>
    </template>
    <OrderDeliveryEstimate :estimate="estimate" />
  </section>
</template>
