<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed } from 'vue'
import { orderStatusFor } from '../stores/orders.js'
import { formatMoscow } from '../orders/customerPricing.js'
import UiPanel from './ui/UiPanel.vue'

const props = defineProps({ order:{ type:Object, required:true }, ops:{ type:Object, required:true } })
const current = computed(() => orderStatusFor(props.ops, props.order.status))
const visible = computed(() => ['in_progress', 'completed'].includes(current.value.upperStatusRouteAlias))
</script>

<template>
  <UiPanel
    v-if="visible"
    title="Выполнение заказа"
  >
    <p>Текущий этап: {{ current.name }}</p>
    <ol aria-label="История этапов заказа">
      <li
        v-for="stage in order.stages"
        :key="stage.status"
      >
        {{ orderStatusFor(ops, stage.status).name }} ·
        <time :datetime="stage.at">{{ formatMoscow(stage.at) }}</time>
      </li>
    </ol>
  </UiPanel>
</template>
