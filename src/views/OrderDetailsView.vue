<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import CustomerCostSummary from '../components/CustomerCostSummary.vue'
import OrderItemFields from '../components/OrderItemFields.vue'
import UiAlert from '../components/ui/UiAlert.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiDialog from '../components/ui/UiDialog.vue'
import UiField from '../components/ui/UiField.vue'
import { CORE_PROBLEM_TYPES, createInternalProblem, normalizeProblem, presentProblem, presentProblemTitle, problemFieldErrors } from '../errors/problem.js'
import { formatMoneyAmount } from '../moneyFormatting.js'
import { isOrderNumber } from '../orderNumber.js'
import { priceCents } from '../orderProduct.js'
import { validateCustomerOrder, validateOrderOps } from '../stores/orders.js'
import { useSession } from '../stores/session.js'
import { useValidationFocus, validationFields } from '../validationFocus.js'

const route = useRoute()
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
const status = computed(() => ops.value?.statuses.find(item => item.value === order.value?.status))
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
const product = computed(() => order.value?.product)
const totalPrice = computed(() => product.value?.sellerPrice
  ? sellerPrice(product.value.sellerPrice, product.value.quantity)
  : '')
const reviewItem = computed(() => ({
  productName:display(product.value?.productName),
  storeName:display(product.value?.storeName),
  sellerPrice:sellerPrice(product.value?.sellerPrice),
  quantity:product.value?.quantity ?? '',
  color:display(product.value?.color),
  size:display(product.value?.size),
  comment:display(product.value?.comment)
}))
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
function display(value) { return value?.trim() || 'Не указано' }
function createdAt(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'
  }).format(new Date(value))
}
function sellerPrice(value, quantity = 1) {
  if (!value) return 'Не указано'
  const currency = ops.value.currencies.find(item => item.value === value.currency)
  const cents = priceCents(value.amount) * BigInt(quantity)
  return `${formatMoneyAmount(Number(cents) / 100)} ${currency.symbol}`
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
      validatedOrder = validateCustomerOrder(value, ops.value, expectedNumber)
      if (ops.value.statuses.find(item => item.value === validatedOrder.status)?.routeAlias !== 'cancelled'
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

    <template v-else-if="order && product">
      <CustomerCostSummary
        :pricing="order.pricing"
        :ops="ops"
        :historical="status?.routeAlias === 'cancelled'"
      />
      <section
        class="order-review-card"
        aria-labelledby="order-product-title"
      >
        <div class="order-review-card__heading">
          <div>
            <p
              v-if="order.showReviewFields"
              class="page-kicker"
            >
              НА ПРОВЕРКЕ
            </p>
            <h2 id="order-product-title">
              Товар
            </h2>
          </div>
        </div>
        <p
          v-if="order.showReviewFields"
          class="order-review-card__notice"
        >
          Проверим данные в течение двух часов.
        </p>
        <OrderItemFields
          :source-url="order.sourceUrl"
          :item="reviewItem"
          :total-price="totalPrice"
          readonly
        />
      </section>
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
