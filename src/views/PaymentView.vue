<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, onUnmounted, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CustomerCostSummary from '../components/CustomerCostSummary.vue'
import PaymentQr from '../components/PaymentQr.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiAlert from '../components/ui/UiAlert.vue'
import PendingView from './PendingView.vue'
import { useSession } from '../stores/session.js'
import { validateOrderOps, orderStatusFor } from '../stores/orders.js'
import { BANK_FIELDS, validatePayment, paymentFingerprint, openPaymentLink } from '../orders/payment.js'
import { isOrderNumber } from '../orderNumber.js'
import { createInternalProblem, normalizeProblem, presentProblem } from '../errors/problem.js'

const session = useSession(), route = useRoute(), router = useRouter()
const payment = ref(null), ops = ref(null), problem = ref(null), loading = ref(false), notice = ref(''), expired = ref(false), qrReady = ref(false)
let generation = 0, timer, pending = null
const number = computed(() => String(route.params.orderNumber ?? ''))
const identity = computed(() => `${session.customer.value?.id ?? ''}:${number.value}`)
const available = computed(() => payment.value?.canPay && !expired.value && !problem.value)
const bank = computed(() => payment.value?.paymentInformation?.information)
const bankFields = computed(() => Object.entries(BANK_FIELDS).filter(([key]) => key !== 'kpp' || bank.value?.recipientType === 0))
const missingCheckout = computed(() => payment.value?.order.status === 100 && !expired.value && !payment.value.order.checkout)
const paid = computed(() => payment.value?.order.status === 300)
const status = computed(() => orderStatusFor(ops.value, expired.value && payment.value?.order.status === 100 ? 200 : payment.value?.order.status))
function reset() {
  generation++; pending = null; globalThis.clearTimeout(timer)
  payment.value = null; ops.value = null; problem.value = null; notice.value = ''; expired.value = false; qrReady.value = false; loading.value = false
}
function armExpiry(value, started) {
  globalThis.clearTimeout(timer)
  const pricing = value.order.pricing
  expired.value = pricing.state === 200
  if (pricing.state !== 100) return
  const remaining = Date.parse(pricing.validUntil) - Date.parse(pricing.asOf) - (Date.now() - started)
  expired.value = remaining <= 0
  if (remaining > 0) timer = globalThis.setTimeout(() => {
    expired.value = true; qrReady.value = false
    void refresh()
  }, Math.min(remaining, 2147483647))
}
function refresh() {
  if (pending) return pending
  const task = load()
  pending = task
  task.finally(() => { if (pending === task) pending = null })
  return task
}
async function load() {
  const current = ++generation, expectedIdentity = identity.value, expectedNumber = number.value
  const isCurrent = () => current === generation && identity.value === expectedIdentity
  loading.value = true; problem.value = null
  try {
    if (!isOrderNumber(expectedNumber)) throw createInternalProblem('invalidInput')
    if (!session.customer.value?.id) return null
    let catalog = ops.value
    if (!catalog) await session.orderRequest('/api/v1/orders/ops', {}, isCurrent, value => { catalog = validateOrderOps(value) })
    if (!isCurrent()) return null
    let result
    const started = Date.now()
    await session.orderRequest(`/api/v1/orders/${encodeURIComponent(expectedNumber)}/payment`, { cache:'no-store' }, isCurrent,
      value => { result = validatePayment(value, catalog, expectedNumber) })
    if (!isCurrent()) return null
    if (payment.value?.paymentInformation?.bundleId !== result.paymentInformation?.bundleId
      || payment.value?.paymentInformation?.qrUrl !== result.paymentInformation?.qrUrl) qrReady.value = false
    ops.value = catalog; payment.value = result; armExpiry(result, started)
    return result
  } catch (value) {
    if (isCurrent()) { payment.value = null; qrReady.value = false; problem.value = normalizeProblem(value) }
    return null
  } finally { if (isCurrent()) loading.value = false }
}
async function pay() {
  if (loading.value || !available.value || !qrReady.value) return
  const expectedIdentity = identity.value, before = paymentFingerprint(payment.value)
  const result = await refresh()
  if (identity.value !== expectedIdentity || !result || !available.value) return
  if (before !== paymentFingerprint(result)) {
    notice.value = 'Платёжные данные изменились. Проверьте сумму и получателя и нажмите ещё раз.'
    return
  }
  if (!qrReady.value) return
  try { openPaymentLink(result.paymentInformation.information.paymentLink) }
  catch (value) { problem.value = normalizeProblem(value) }
}
function back() { return router.push({ name:'order-details', params:{ orderNumber:number.value } }) }
function checkout() { return router.push({ name:'checkout', params:{ orderNumber:number.value } }) }
function revisit() { if (globalThis.document.visibilityState === 'visible') void refresh() }
watch(identity, () => { reset(); void refresh() }, { immediate:true, flush:'sync' })
onMounted(() => globalThis.document.addEventListener('visibilitychange', revisit))
onUnmounted(() => { reset(); globalThis.document.removeEventListener('visibilitychange', revisit) })
</script>
<template>
  <PendingView
    v-if="payment && !available && !missingCheckout && !paid && payment.order.status === 100 && !expired"
    title="Оплата"
    copy="Оплата пока недоступна. Попробуйте позже"
  >
    <UiButton @click="refresh">
      Обновить
    </UiButton>
    <UiButton @click="back">
      К заказу
    </UiButton>
  </PendingView>
  <main
    v-else
    class="page-container payment-view"
  >
    <header class="page-heading order-details-heading">
      <h1>Оплата заказа {{ number }}</h1>
      <div class="order-details-heading__actions">
        <UiButton
          :loading="loading"
          @click="refresh"
        >
          Обновить
        </UiButton>
        <UiButton @click="back">
          К заказу
        </UiButton>
      </div>
    </header>
    <UiAlert v-if="problem">
      {{ presentProblem(problem) }}
    </UiAlert>
    <p
      v-else-if="loading && !payment"
      role="status"
    >
      Загружаем платёжные данные…
    </p>
    <template v-if="payment">
      <UiAlert
        v-if="notice"
        role="status"
      >
        {{ notice }}
      </UiAlert>
      <p
        v-if="paid"
        role="status"
      >
        Заказ оплачен.
      </p>
      <template v-else-if="missingCheckout">
        <p>Заполните данные получателя и доставки перед оплатой.</p>
        <UiButton
          variant="primary"
          @click="checkout"
        >
          Оформить заказ
        </UiButton>
      </template>
      <p
        v-else-if="!available"
        role="status"
      >
        {{ status.name }}. Оплата недоступна.
      </p>
      <template v-else>
        <CustomerCostSummary
          payment
          :main-payment-rub="payment.mainPaymentRub"
          :pricing="payment.order.pricing"
          :ops="ops"
          delivery-selected
        />
        <p>Получатель: <strong>{{ bank.recipientName }}</strong></p>
        <div class="payment-methods">
          <div>
            <p>Отсканируйте QR-код в приложении банка. Вручную введите указанную сумму, проверьте получателя и подтвердите платёж в банке.</p>
            <PaymentQr
              :key="payment.paymentInformation.bundleId"
              :url="payment.paymentInformation.qrUrl"
              :identity="identity"
              @ready="qrReady = $event"
            />
          </div>
          <div>
            <UiButton
              class="bank-payment"
              variant="primary"
              :disabled="loading || !qrReady"
              @click="pay"
            >
              Оплатить через СБП
            </UiButton>
            <p>При возврате из банка статус заказа обновит сотрудник после сверки платежа.</p>
          </div>
        </div>
        <details class="payment-details">
          <summary>Банковские реквизиты</summary>
          <dl>
            <div
              v-for="[key, label] in bankFields"
              :key="key"
            >
              <dt>{{ label }}</dt><dd>{{ bank[key] }}</dd>
            </div>
          </dl>
        </details>
      </template>
    </template>
  </main>
</template>
<style scoped>
.payment-methods { display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1fr); gap:2rem; }
.payment-details { margin-top:1.5rem; }
.payment-details dl div { margin-top:.75rem; }
.payment-details dd { margin:0; overflow-wrap:anywhere; }
@media (min-width:769px) { .bank-payment { background:transparent; color:var(--color-primary, #1976d2); } }
@media (max-width:768px) { .payment-methods { display:flex; flex-direction:column-reverse; } .bank-payment { width:100%; } }
</style>
