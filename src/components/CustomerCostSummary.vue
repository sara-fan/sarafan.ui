<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, onUnmounted, ref, watch } from 'vue'
import { PaidIndicator } from '../paidIndicator.js'
import { formatMoscow, formatRub } from '../orders/customerPricing.js'

const props = defineProps({
  pricing: { type: Object, default: null },
  ops: { type: Object, default: null },
  compact: { type: Boolean, default: false },
  payment: { type:Boolean, default:false },
  mainPaymentRub: { type:Number, default:null },
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
  if (!props.payment && pricing?.validUntil && pricing.state === 100) {
    const remaining = Date.parse(pricing.validUntil) - Date.parse(pricing.asOf)
    if (remaining <= 0) expiredNow.value = true
    else timer = globalThis.setTimeout(() => { expiredNow.value = true }, Math.min(remaining, 2147483647))
  }
}, { immediate: true })
onUnmounted(() => globalThis.clearTimeout(timer))

const state = computed(() => expiredNow.value ? 200 : props.pricing?.state ?? 0)
const label = computed(() => props.payment ? 'Сумма к оплате' : props.historical ? 'Последняя рассчитанная стоимость'
  : props.preview ? 'Прогнозная стоимость'
  : props.pricing?.state === 0 ? 'Предварительная стоимость'
  : props.ops?.pricingStates?.find(item => item.value === state.value)?.name ?? 'Стоимость заказа')
const rubSymbol = computed(() => props.ops?.currencies?.find(item => item.routeAlias === 'rub')?.symbol ?? '₽')
const notCalculatedText = 'Расчёт не проводился'
const pendingCalculationText = 'Будут рассчитаны позже'
const extrasNotCalculated = computed(() => props.historical || state.value === 200)
const totalText = computed(() => props.payment ? formatRub(props.mainPaymentRub, rubSymbol.value) : props.historical && props.pricing?.totalRub == null
  ? notCalculatedText : formatRub(props.pricing?.totalRub ?? null, rubSymbol.value))
const deliveryText = computed(() => {
  const amount = props.pricing?.domesticDeliveryRub
  if (amount == null && extrasNotCalculated.value) return notCalculatedText
  if (props.historical) return formatRub(amount, rubSymbol.value)
  return props.deliverySelected && amount != null ? 'Предварительно ' + formatRub(amount, rubSymbol.value)
    : props.deliverySelected ? pendingCalculationText : 'Рассчитаем при оформлении заказа'
})
const customsText = computed(() => {
  const amount = props.pricing?.state === 0 && !props.historical ? null : props.pricing?.customsRub
  if (amount == null) return props.historical ? 'Расчёт не проводился' : props.pricing?.state === 0 ? 'Проверяем, потребуются ли таможенные платежи' : pendingCalculationText
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
        <component
          :is="compact ? 'h3' : 'h2'"
          class="ui-section-title"
        >
          {{ label }}
        </component>
        <strong>
          {{ loading ? 'Рассчитываем стоимость…' : totalText }}
          <PaidIndicator
            :paid="pricing?.mainPaymentPaid === true"
            label="Основной платёж подтверждён"
          />
        </strong>
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
      {{ payment ? 'Таможенные платежи оплачиваются отдельно и не входят в сумму к оплате.' : 'Доставка по России и таможенные платежи не входят в указанную стоимость.' }}
    </p>
    <dl
      v-if="!compact"
      class="customer-cost__excluded"
    >
      <div v-if="payment">
        <dt>Подтверждённая стоимость заказа</dt>
        <dd>{{ formatRub(pricing.totalRub, rubSymbol) }}</dd>
      </div>
      <div>
        <dt>Доставка по России</dt>
        <dd>
          {{ deliveryText }}
          <PaidIndicator
            :paid="pricing?.mainPaymentPaid === true && pricing?.domesticDeliveryRub != null"
            label="Доставка по России оплачена"
          />
        </dd>
      </div>
      <div>
        <dt>Таможенные платежи</dt>
        <dd>
          {{ customsText }}
          <PaidIndicator
            :paid="pricing?.customsPaid === true"
            label="Таможенная пошлина оплачена"
          />
        </dd>
      </div>
    </dl>
    <p
      v-if="!payment && (historical || state === 200)"
      class="customer-cost__status"
    >
      Сохранённая стоимость показана для справки.
    </p>
    <p
      v-else-if="!payment && state === 100 && pricing?.validUntil"
      class="customer-cost__status"
    >
      Действует до {{ formatMoscow(pricing.validUntil) }}
    </p>
  </section>
</template>
