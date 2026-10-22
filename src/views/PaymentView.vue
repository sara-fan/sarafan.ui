<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, onUnmounted, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CustomerCostSummary from '../components/CustomerCostSummary.vue'
import PaymentMethod from '../components/PaymentMethod.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiPanel from '../components/ui/UiPanel.vue'
import UiField from '../components/ui/UiField.vue'
import UiAlert from '../components/ui/UiAlert.vue'
import PendingView from './PendingView.vue'
import { useSession } from '../stores/session.js'
import { validateOrderOps, orderStatusFor } from '../stores/orders.js'
import { BANK_FIELDS, validatePayment, paymentFingerprint, openPaymentLink } from '../orders/payment.js'
import { isOrderNumber } from '../orderNumber.js'
import { scheduleBoundary } from '../consentTiming.js'
import { createInternalProblem, normalizeProblem, presentProblem } from '../errors/problem.js'

const session = useSession(), route = useRoute(), router = useRouter()
const payment = ref(null), ops = ref(null), problem = ref(null), loading = ref(false), notice = ref(''), expired = ref(false)
let generation = 0, navigationGeneration = 0, timer, pending = null
const number = computed(() => String(route.params.orderNumber ?? ''))
const identity = computed(() => `${session.customer.value?.id ?? ''}:${number.value}`)
const available = computed(() => payment.value?.canPay && !expired.value && !problem.value)
const bank = computed(() => payment.value?.paymentInformation?.information)
const bankFields = computed(() => Object.entries(BANK_FIELDS).filter(([key]) => key !== 'kpp' || bank.value?.recipientType === 0))
const missingCheckout = computed(() => payment.value?.order.status === 100 && !expired.value && !payment.value.order.checkout)
const paid = computed(() => payment.value?.order.status === 300)
const status = computed(() => orderStatusFor(ops.value, expired.value && payment.value?.order.status === 100 ? 200 : payment.value?.order.status))
function reset() {
  generation++; navigationGeneration++; pending = null; globalThis.clearTimeout(timer)
  payment.value = null; ops.value = null; problem.value = null; notice.value = ''; expired.value = false; loading.value = false
}
function armExpiry(value, started) {
  globalThis.clearTimeout(timer)
  const pricing = value.order.pricing
  expired.value = pricing.mainPaymentPaid !== true && pricing.state === 200
  if (pricing.state !== 100 || pricing.mainPaymentPaid === true) return
  const remaining = Date.parse(pricing.validUntil) - Date.parse(pricing.asOf) - (Date.now() - started)
  expired.value = remaining <= 0
  if (remaining > 0) scheduleBoundary(remaining, value => { timer = value }, () => {
    armExpiry(value, started)
    if (expired.value) void refresh()
  })
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
    ops.value = catalog; payment.value = result; armExpiry(result, started)
    return result
  } catch (value) {
    if (isCurrent()) { payment.value = null; problem.value = normalizeProblem(value) }
    return null
  } finally { if (isCurrent()) loading.value = false }
}
async function pay() {
  if (loading.value || !available.value) return
  const expectedIdentity = identity.value, before = paymentFingerprint(payment.value)
  const result = await refresh()
  if (identity.value !== expectedIdentity || !result || !available.value) return
  if (before !== paymentFingerprint(result)) {
    notice.value = 'Платёжные данные изменились. Проверьте сумму и получателя и нажмите ещё раз.'
    return
  }
  try { openPaymentLink(result.paymentInformation.information.paymentLink) }
  catch (value) { problem.value = normalizeProblem(value) }
}
async function navigate(target) {
  const current = ++navigationGeneration
  try { await router.push(target) }
  catch (value) { if (current === navigationGeneration) problem.value = normalizeProblem(value) }
}
function back() { return navigate({ name:'order-details', params:{ orderNumber:number.value } }) }
function checkout() { return navigate({ name:'checkout', params:{ orderNumber:number.value } }) }
function home() { return navigate({ name:'home' }) }
function revisit() { if (globalThis.document.visibilityState === 'visible') void refresh() }
watch(identity, () => { reset(); void refresh() }, { immediate:true, flush:'sync' })
onMounted(() => globalThis.document.addEventListener('visibilitychange', revisit))
onUnmounted(() => { reset(); globalThis.document.removeEventListener('visibilitychange', revisit) })
</script>
<template>
  <PendingView
    v-if="!problem && payment && !available && !missingCheckout && !paid && payment.order.status === 100 && !expired"
    title="Оплата"
    copy="Оплата пока недоступна. Попробуйте позже"
    :home-action="home"
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
      <div
        v-else
        class="ui-form-stack"
      >
        <CustomerCostSummary
          payment
          :main-payment-rub="payment.mainPaymentRub"
          :pricing="payment.order.pricing"
          :ops="ops"
          delivery-selected
        />
        <UiPanel title="Оплата через СБП">
          <p>Получатель: <strong>{{ bank.recipientName }}</strong></p>
          <PaymentMethod
            :key="payment.paymentInformation.bundleId"
            :qr-url="payment.paymentInformation.qrUrl"
            :identity="identity"
            :disabled="loading"
            @pay="pay"
          />
        </UiPanel>
        <UiPanel title="Банковские реквизиты">
          <div class="ui-field-grid">
            <UiField
              v-for="[key, label] in bankFields"
              :key="key"
              :model-value="bank[key]"
              :label="label"
              readonly
            />
          </div>
        </UiPanel>
      </div>
    </template>
  </main>
</template>
