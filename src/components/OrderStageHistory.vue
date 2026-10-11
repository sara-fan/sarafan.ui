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
    <table
      class="order-stage-history"
      aria-label="История этапов заказа"
    >
      <caption class="ui-visually-hidden">
        Текущий этап: {{ current.name }}
      </caption>
      <thead class="ui-visually-hidden">
        <tr>
          <th scope="col">
            Этап
          </th>
          <th scope="col">
            Дата и время
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="stage in order.stages"
          :key="stage.status"
          :aria-current="stage.status === order.status ? 'step' : undefined"
        >
          <th scope="row">
            {{ orderStatusFor(ops, stage.status).name }}
            <span
              v-if="stage.status === order.status"
              class="ui-spinner order-stage-history__spinner"
              role="img"
              aria-label="Текущий этап"
            />
          </th>
          <td><time :datetime="stage.at">{{ formatMoscow(stage.at) }}</time></td>
        </tr>
        <tr v-if="order.stages.length === 0">
          <td colspan="2">
            Зафиксированных этапов пока нет.
          </td>
        </tr>
      </tbody>
    </table>
  </UiPanel>
</template>
