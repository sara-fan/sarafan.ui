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

/*! Font Awesome Free 7.3.1 by @fontawesome - https://fontawesome.com
 * Icons: CC BY 4.0 - https://fontawesome.com/license/free
 * Copyright 2026 Fonticons, Inc.
 */
const stageIcons = {
  paid: {
    class: 'fa-solid fa-check',
    path: 'M434.8 70.1c14.3 10.4 17.5 30.4 7.1 44.7l-256 352c-5.5 7.6-14 12.3-23.4 13.1s-18.5-2.7-25.1-9.3l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l101.5 101.5 234-321.7c10.4-14.3 30.4-17.5 44.7-7.1z'
  },
  received: {
    class: 'fa-regular fa-square-check',
    path: 'M384 32c35.3 0 64 28.7 64 64l0 320c0 35.3-28.7 64-64 64L64 480c-35.3 0-64-28.7-64-64L0 96C0 60.7 28.7 32 64 32l320 0zM64 80c-8.8 0-16 7.2-16 16l0 320c0 8.8 7.2 16 16 16l320 0c8.8 0 16-7.2 16-16l0-320c0-8.8-7.2-16-16-16L64 80zm230.7 89.9c7.8-10.7 22.8-13.1 33.5-5.3 10.7 7.8 13.1 22.8 5.3 33.5L211.4 366.1c-4.1 5.7-10.5 9.3-17.5 9.8-7 .5-13.9-2-18.8-6.9l-55.9-55.9c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l36 36 105.6-145.2z'
  }
}
const currentIcon = computed(() => stageIcons[current.value.routeAlias])
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
              class="order-stage-history__indicator"
              :class="{ 'ui-spinner': !currentIcon }"
              role="img"
              aria-label="Текущий этап"
            >
              <svg
                v-if="currentIcon"
                :class="currentIcon.class"
                viewBox="0 0 448 512"
                aria-hidden="true"
                focusable="false"
              >
                <path :d="currentIcon.path" />
              </svg>
            </span>
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
