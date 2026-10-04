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
  historical: { type: Boolean, default: false },
  deliverySelected: { type: Boolean, default: false },
  preview: { type: Boolean, default: false },
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
const label = computed(() => props.historical ? 'Последняя рассчитанная стоимость'
  : props.preview ? 'Прогнозная стоимость'
  : props.pricing?.state === 0 ? 'Предварительная стоимость'
  : props.ops?.pricingStates?.find(item => item.value === state.value)?.name ?? 'Стоимость заказа')
const rubSymbol = computed(() => props.ops?.currencies?.find(item => item.routeAlias === 'rub')?.symbol ?? '₽')
const totalText = computed(() => props.historical && props.pricing?.totalRub == null
  ? 'Рассчёт не проводился' : formatRub(props.pricing?.totalRub ?? null, rubSymbol.value))
const deliveryText = computed(() => props.historical
  ? props.pricing?.domesticDeliveryRub == null ? 'Рассчёт не проводился' : formatRub(props.pricing.domesticDeliveryRub, rubSymbol.value)
  : props.deliverySelected && props.pricing?.domesticDeliveryRub != null ? 'Предварительно ' + formatRub(props.pricing.domesticDeliveryRub, rubSymbol.value)
  : props.deliverySelected ? 'Будут рассчитаны позже' : 'Рассчитаем при оформлении заказа')
const customsText = computed(() => {
  const amount = props.pricing?.state === 0 ? null : props.pricing?.customsRub
  if (amount == null) return props.historical ? 'Рассчёт не проводился' : props.pricing?.state === 0 ? 'Проверяем, потребуются ли таможенные платежи' : 'Будут рассчитаны позже'
  return amount === 0 ? 'Не ожидаются' : 'Предварительно ' + formatRub(amount, rubSymbol.value)
})
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
      <div class="customer-cost__headline">
        <span>{{ label }}</span>
        <strong>{{ loading ? 'Рассчитываем стоимость…' : totalText }}</strong>
      </div>
      <p
        v-if="preview"
        class="customer-cost__preview-notice"
      >
        Расчёт ориентировочный и не является офертой.
      </p>
    </div>
    <p
      v-if="!compact"
      class="customer-cost__note"
    >
      Доставка по России и таможенные платежи не входят в указанную стоимость.
    </p>
    <dl
      v-if="!compact"
      class="customer-cost__excluded"
    >
      <div>
        <dt>Доставка по России</dt>
        <dd>
          {{ deliveryText }}
        </dd>
      </div>
      <div>
        <dt>Таможенные платежи</dt>
        <dd>
          {{ customsText }}
        </dd>
      </div>
    </dl>
    <p
      v-if="historical || state === 200"
      class="customer-cost__status"
    >
      Сохранённая стоимость показана для справки.
    </p>
    <p
      v-else-if="state === 100 && pricing?.validUntil"
      class="customer-cost__status"
    >
      Действует до {{ formatMoscow(pricing.validUntil) }}
    </p>
  </section>
</template>
