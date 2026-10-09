<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import CustomerCostSummary from '../components/CustomerCostSummary.vue'
import OrderDeliveryEstimate from '../components/OrderDeliveryEstimate.vue'
import OrderSavedDelivery from '../components/OrderSavedDelivery.vue'
import OrderItemCard from '../components/OrderItemCard.vue'
import UiAlert from '../components/ui/UiAlert.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiDialog from '../components/ui/UiDialog.vue'
import UiField from '../components/ui/UiField.vue'
import { CORE_PROBLEM_TYPES, createInternalProblem, normalizeProblem, presentProblem, presentProblemTitle, problemFieldErrors } from '../errors/problem.js'
import { isOrderNumber } from '../orderNumber.js'
import { orderStatusFor, validateCustomerOrder, validateOrderOps } from '../stores/orders.js'
import { useSession } from '../stores/session.js'
import { useValidationFocus, validationFields } from '../validationFocus.js'

const route = useRoute()
const router = useRouter()
const expired = ref(false)
let expiryTimer
const session = useSession()
const order = ref(null)
const ops = ref(null)
const problem = ref(null)
const loading = ref(false)
const cancelOpen = ref(false)
const cancelBusy = ref(false)
const cancelReason = ref('')
const cancelProblem = ref(null)
const cancelledNotice = ref(false)
const cancelFocusRoot = ref(null)
let loadGeneration = 0
let cancellationGeneration = 0
let inFlight = null

const error = computed(() => presentProblem(problem.value))
const errorTitle = computed(() => presentProblemTitle(problem.value))
const status = computed(() => orderStatusFor(ops.value, expired.value && order.value?.status === 100 ? 200 : order.value?.status))
watch(() => order.value?.pricing, pricing => {
  globalThis.clearTimeout(expiryTimer)
  expired.value = pricing?.state === 200
  if (pricing?.state === 100) {
    const delay = Date.parse(pricing.validUntil) - Date.parse(pricing.asOf)
    if (delay <= 0) expired.value = true
    else expiryTimer = globalThis.setTimeout(() => { expired.value = true; if (!cancelBusy.value) void load() }, Math.min(delay, 2147483647))
  }
})
const canCheckout = computed(() => status.value?.routeAlias === 'quote_ready' && order.value?.pricing.state === 100 && !expired.value)
async function checkout() {
  const customerId = session.customer.value?.id
  const expectedNumber = orderNumber()
  await load()
  if (customerId !== session.customer.value?.id || expectedNumber !== orderNumber() || !canCheckout.value) return
  try { await router.push({ name:'checkout', params:{ orderNumber:expectedNumber } }) }
  catch (value) { if (customerId === session.customer.value?.id && expectedNumber === orderNumber()) problem.value = normalizeProblem(value) }
}
const headingDetail = computed(() => {
  if (!order.value) return ''
  const creation = createdAt(order.value.createdAt)
  if (status.value?.routeAlias === 'cancelled') {
    return order.value.cancelledAt
      ? `Создан ${creation} · Отменён ${createdAt(order.value.cancelledAt)}`
      : `Создан ${creation} · Отменён`
  }
  return `${status.value?.name} · создан ${creation}`
})
const cancelReasonErrors = computed(() => problemFieldErrors(cancelProblem.value, 'reason'))
const cancelError = computed(() => cancelProblem.value && cancelReasonErrors.value.length === 0 ? presentProblem(cancelProblem.value) : '')
const cancelErrorTitle = computed(() => cancelProblem.value ? presentProblemTitle(cancelProblem.value) : '')
function orderNumber() {
  const value = String(route.params.orderNumber ?? '')
  const rawSegment = route.path.startsWith('/orders/') ? route.path.slice('/orders/'.length) : ''
  try {
    decodeURIComponent(rawSegment)
  } catch {
    return null
  }
  return isOrderNumber(value) ? value : null
}
function createdAt(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'
  }).format(new Date(value))
}

function openCancellation() {
  cancelReason.value = ''
  cancelProblem.value = null
  cancelOpen.value = true
}
function closeCancellation() {
  if (cancelBusy.value) return
  cancelOpen.value = false
  cancelProblem.value = null
}
const focusAfterCancel = useValidationFocus(cancelFocusRoot, {
  context:() => `${session.customer.value?.id ?? ''}:${orderNumber() ?? ''}`,
  active:() => cancelOpen.value,
  ready:() => !cancelBusy.value
})
function submitCancellation() {
  return focusAfterCancel(cancelAction, () => validationFields(cancelProblem.value))
}
async function cancelAction() {
  if (cancelBusy.value || !order.value?.canCancel) return
  const reason = cancelReason.value.trim()
  if (reason.length > 2000) {
    cancelProblem.value = createInternalProblem('invalidInput', {
      errors:{ reason:['Причина отмены не должна превышать 2000 символов.'] }
    })
    return
  }
  const requestGeneration = ++cancellationGeneration
  const customerId = session.customer.value?.id
  const expectedNumber = orderNumber()
  const cancellationOps = ops.value
  const isCurrent = () => requestGeneration === cancellationGeneration && customerId === session.customer.value?.id
    && expectedNumber === orderNumber()
  cancelBusy.value = true
  cancelProblem.value = null
  try {
    let validatedOrder
    await session.orderRequest(`/api/v1/orders/${encodeURIComponent(expectedNumber)}/cancel`, {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ expectedUpdatedAt:order.value.updatedAt, reason:reason || null })
    }, isCurrent, value => {
      validatedOrder = validateCustomerOrder(value, cancellationOps, expectedNumber)
      if (cancellationOps.statuses.find(item => item.value === validatedOrder.status)?.routeAlias !== 'cancelled'
        || validatedOrder.canCancel || !validatedOrder.cancelledAt) throw createInternalProblem('protocolError')
    })
    if (!isCurrent()) return
    order.value = validatedOrder
    cancelOpen.value = false
    cancelReason.value = ''
    cancelledNotice.value = true
  } catch (value) {
    if (!isCurrent()) return
    const normalized = normalizeProblem(value, { detail:'Не удалось отменить заказ' })
    if (normalized.type === CORE_PROBLEM_TYPES.orderUpdateConflict
      || normalized.type === CORE_PROBLEM_TYPES.orderNotCancellable) {
      cancelOpen.value = false
      cancelBusy.value = false
      await load()
      if (!isCurrent()) return
      if (!problem.value) problem.value = normalized
    } else cancelProblem.value = normalized
  } finally {
    if (isCurrent()) cancelBusy.value = false
  }
}
function load() {
  const key = `${session.customer.value?.id ?? ''}:${orderNumber() ?? ''}`
  if (inFlight?.key === key) return inFlight.promise
  const task = loadCurrent()
  const promise = task.finally(() => { if (inFlight?.promise === promise) inFlight = null })
  inFlight = { key, promise }
  return promise
}

async function loadCurrent() {
  const requestGeneration = ++loadGeneration
  const customerId = session.customer.value?.id
  const expectedNumber = orderNumber()
  const isCurrent = () => requestGeneration === loadGeneration
    && customerId === session.customer.value?.id && expectedNumber === orderNumber()
  problem.value = null
  cancelledNotice.value = false
  order.value = null
  ops.value = null
  if (expectedNumber === null) {
    loading.value = false
    problem.value = createInternalProblem('invalidInput')
    return
  }
  if (!customerId) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    let validatedOps
    await session.orderRequest('/api/v1/orders/ops', {}, isCurrent, value => {
      validatedOps = validateOrderOps(value)
    })
    if (!isCurrent()) return
    let validatedOrder
    await session.orderRequest(`/api/v1/orders/${encodeURIComponent(expectedNumber)}`, {}, isCurrent, value => {
      validatedOrder = validateCustomerOrder(value, validatedOps, expectedNumber)
    })
    if (!isCurrent()) return
    ops.value = validatedOps
    order.value = validatedOrder
  } catch (value) {
    if (isCurrent()) problem.value = normalizeProblem(value, { detail:'Не удалось загрузить заказ' })
  } finally {
    if (requestGeneration === loadGeneration) loading.value = false
  }
}

function revisit() { if (globalThis.document.visibilityState === 'visible' && !cancelBusy.value) void load() }

const stopWatch = watch(
  [() => route.params.orderNumber, () => session.customer.value?.id],
  () => { cancellationGeneration++; cancelOpen.value = false; cancelBusy.value = false; cancelReason.value = ''; cancelProblem.value = null; void load() },
  { immediate:true, flush:'sync' }
)

onMounted(() => globalThis.document.addEventListener('visibilitychange', revisit))

onBeforeUnmount(() => {
  globalThis.clearTimeout(expiryTimer)
  loadGeneration++
  cancellationGeneration++
  inFlight = null
  globalThis.document.removeEventListener('visibilitychange', revisit)
  stopWatch()
})
</script>

<template>
  <main class="page-container order-details-view">
    <header class="page-heading order-details-heading">
      <div>
        <h1>{{ order ? `Заказ ${order.orderNumber}` : 'Заказ' }}</h1>
        <p v-if="order">
          {{ headingDetail }}
        </p>
      </div>
      <div
        v-if="order"
        class="order-details-heading__actions"
      >
        <UiButton
          v-if="canCheckout"
          variant="primary"
          :disabled="loading || cancelBusy"
          @click="checkout"
        >
          Оформить заказ
        </UiButton>
        <UiButton
          :loading="loading"
          :disabled="cancelBusy"
          @click="load"
        >
          Обновить
        </UiButton>
        <UiButton
          v-if="order.canCancel"
          variant="danger"
          :disabled="loading || cancelBusy"
          @click="openCancellation"
        >
          Отменить заказ
        </UiButton>
      </div>
    </header>

    <UiAlert
      v-if="cancelledNotice"
      tone="success"
      role="status"
    >
      Заказ отменён
    </UiAlert>

    <UiAlert
      v-if="problem"
      :title="errorTitle"
    >
      <p>{{ error }}</p>
      <UiButton
        :loading="loading"
        @click="load"
      >
        Повторить
      </UiButton>
    </UiAlert>

    <section
      v-else-if="loading"
      class="product-state"
      aria-label="Загрузка заказа"
      aria-live="polite"
    >
      <span
        class="route-gate__spinner"
        aria-hidden="true"
      />
      <p>Загружаем заказ…</p>
    </section>

    <template v-else-if="order">
      <UiAlert
        v-if="order.reviewReason"
        title="Не можем привезти"
      >
        {{ order.reviewReason }}
      </UiAlert>
      <OrderDeliveryEstimate :estimate="order.estimatedDelivery" />
      <OrderSavedDelivery :delivery="order.checkout?.delivery" />
      <CustomerCostSummary
        :pricing="order.pricing"
        :delivery-selected="Boolean(order.checkout)"
        :ops="ops"
        :historical="['cancelled', 'cannot_deliver'].includes(status?.routeAlias)"
      />
      <OrderItemCard
        :order="order"
        :ops="ops"
      />
    </template>

    <UiDialog
      v-model="cancelOpen"
      :title="`Отменить заказ ${order?.orderNumber ?? ''}?`"
      :persistent="cancelBusy"
    >
      <div ref="cancelFocusRoot">
        <p>Заказ будет отменён. Восстановить его нельзя.</p>
        <UiField
          v-model="cancelReason"
          name="reason"
          label="Причина отмены (необязательно)"
          multiline
          :maxlength="2000"
          :disabled="cancelBusy"
          :errors="cancelReasonErrors"
        />
        <UiAlert
          v-if="cancelError"
          :title="cancelErrorTitle"
        >
          {{ cancelError }}
        </UiAlert>
      </div>
      <template #actions>
        <UiButton
          :disabled="cancelBusy"
          @click="closeCancellation"
        >
          Оставить заказ
        </UiButton>
        <UiButton
          variant="danger"
          :loading="cancelBusy"
          @click="submitCancellation"
        >
          Отменить заказ
        </UiButton>
      </template>
    </UiDialog>
  </main>
</template>
