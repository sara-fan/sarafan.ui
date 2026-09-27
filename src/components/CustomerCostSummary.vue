<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, onUnmounted, ref, watch } from 'vue'
import { formatMoscow, formatRub } from '../orders/customerPricing.js'

const props = defineProps({
  pricing: { type: Object, default: null },
  ops: { type: Object, default: null },
  compact: { type: Boolean, default: false },
  loading: { type: Boolean, default: false }
})

const expiredNow = ref(false)
let timer
watch(() => props.pricing, pricing => {
  globalThis.clearTimeout(timer)
  expiredNow.value = false
  if (pricing?.validUntil && pricing.state === 100) {
    const remaining = Date.parse(pricing.validUntil) - Date.parse(pricing.asOf)
    if (remaining <= 0) expiredNow.value = true
    else timer = globalThis.setTimeout(() => { expiredNow.value = true }, Math.min(remaining, 2147483647))
  }
}, { immediate: true })
onUnmounted(() => globalThis.clearTimeout(timer))

const state = computed(() => expiredNow.value ? 200 : props.pricing?.state ?? 0)
const label = computed(() => props.ops?.pricingStates?.find(item => item.value === state.value)?.name ?? 'Стоимость заказа')
const rubSymbol = computed(() => props.ops?.currencies?.find(item => item.routeAlias === 'rub')?.symbol ?? '₽')
</script>

<template>
  <section
    class="customer-cost"
    :class="{ 'customer-cost--compact': compact }"
    aria-label="Стоимость заказа"
  >
    <div
      class="customer-cost__main"
      aria-live="polite"
    >
      <span>{{ label }}</span>
      <strong>{{ loading ? 'Рассчитываем стоимость…' : formatRub(pricing?.totalRub ?? null, rubSymbol) }}</strong>
      <p v-if="state === 200">
        Срок подтверждения истёк. Сохранённая стоимость показана для справки.
      </p>
      <p v-else-if="state === 100 && pricing?.validUntil">
        Действует до {{ formatMoscow(pricing.validUntil) }}
      </p>
      <p v-else>
        Предварительная стоимость будет проверена после отправки заявки.
      </p>
    </div>
    <dl v-if="!compact">
      <div><dt>Доставка по России</dt><dd>{{ formatRub(pricing?.domesticDeliveryRub ?? null, rubSymbol) }}</dd></div>
      <div><dt>Таможенные платежи</dt><dd>{{ formatRub(pricing?.customsRub ?? null, rubSymbol) }}</dd></div>
    </dl>
    <p
      v-if="!compact"
      class="customer-cost__note"
    >
      Доставка по России и таможенные платежи не входят в указанную стоимость.
    </p>
    <div
      v-if="!compact && state !== 0"
      class="customer-cost__future"
    >
      <p>Дополнительные услуги</p>
      <ul>
        <li>Фото на складе — В разработке</li>
        <li>Проверка товара — В разработке</li>
        <li>Страхование отправления — В разработке</li>
      </ul>
    </div>
  </section>
</template>
