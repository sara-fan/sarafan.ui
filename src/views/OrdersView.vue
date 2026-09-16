<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import UiAlert from '../components/ui/UiAlert.vue'
import UiButton from '../components/ui/UiButton.vue'
import { normalizeProblem, presentProblem } from '../errors/problem.js'
import { formatMoneyAmount } from '../moneyFormatting.js'
import { createOrderStore } from '../stores/orders.js'
import { consumeOrderCreated } from '../stores/orderNotices.js'
import { useSession } from '../stores/session.js'

const session = useSession()
const router = useRouter()
const store = createOrderStore(session)
const problem = ref(null)
const failedImages = ref(new Set())
const createdOrderNumber = ref(consumeOrderCreated(session.customer.value?.id))
let mounted = true

const activeOrders = computed(() => store.orders.value.filter(order => !store.statusFor(order.status)?.isTerminal))
const historyOrders = computed(() => store.orders.value.filter(order => store.statusFor(order.status)?.isTerminal))
const error = computed(() => problem.value ? presentProblem(problem.value) : '')

function pluralizeOrders(count) {
  const lastTwo = count % 100
  const last = count % 10
  const word = lastTwo >= 11 && lastTwo <= 14 ? 'заказов'
    : last === 1 ? 'заказ'
      : last >= 2 && last <= 4 ? 'заказа' : 'заказов'
  return `${count} ${word}`
}
function quantityText(quantity) {
  const lastTwo = quantity % 100
  const last = quantity % 10
  const word = lastTwo >= 11 && lastTwo <= 14 ? 'товаров'
    : last === 1 ? 'товар'
      : last >= 2 && last <= 4 ? 'товара' : 'товаров'
  return `${quantity} ${word}`
}
function status(order) { return store.statusFor(order.status) }
function productName(order) { return order.productName?.trim() || 'Товар уточняется' }
function storeName(order) { return order.storeName?.trim() || 'Магазин уточняется' }
function createdAt(value) {
  return new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'long', year:'numeric' }).format(new Date(value))
}
function sellerPrice(order) {
  if (!order.sellerPrice) return 'Уточняется'
  const currency = store.currencyFor(order.sellerPrice.currency)
  const formatted = formatMoneyAmount(order.sellerPrice.amount)
  let symbol
  try {
    symbol = new Intl.NumberFormat('ru-RU', {
      style:'currency', currency:currency.routeAlias.toUpperCase(), currencyDisplay:'narrowSymbol'
    }).formatToParts(0).find(part => part.type === 'currency')?.value
  } catch {
    symbol = null
  }
  return symbol ? `${symbol} ${formatted}` : `${formatted} ${currency.name}`
}
function hasImage(order) { return Boolean(order.imageUrl) && !failedImages.value.has(order.orderNumber) }
function markImageFailed(orderNumber) {
  failedImages.value = new Set([...failedImages.value, orderNumber])
}
function addProduct() { return router.push({ name:'home' }) }
async function load() {
  problem.value = null
  try {
    await store.load()
  } catch (value) {
    if (mounted) problem.value = normalizeProblem(value, { detail:'Не удалось загрузить заказы' })
  }
}

const stopCustomerWatch = watch(() => session.customer.value?.id, (customerId, previousCustomerId) => {
  if (customerId === previousCustomerId) return
  store.reset()
  problem.value = null
  createdOrderNumber.value = consumeOrderCreated(customerId)
  failedImages.value = new Set()
  if (customerId) void load()
}, { flush:'sync' })

onMounted(load)
onBeforeUnmount(() => {
  mounted = false
  stopCustomerWatch()
  store.dispose()
})
</script>

<template>
  <main class="page-container orders-view">
    <header class="page-heading orders-heading">
      <div>
        <h1>Мои заказы</h1>
        <p>Следите за проверкой, оплатой и доставкой ваших заказов.</p>
      </div>
    </header>

    <UiAlert
      v-if="createdOrderNumber && !problem"
      title="Заказ создан"
      tone="success"
      class="orders-created-notice"
    >
      Номер заказа {{ createdOrderNumber }}.
    </UiAlert>

    <UiAlert
      v-else-if="problem"
      title="Не удалось загрузить заказы"
    >
      <p>{{ error }}</p>
      <UiButton
        :loading="store.loading.value"
        @click="load"
      >
        Повторить
      </UiButton>
    </UiAlert>

    <section
      class="orders-panel"
      aria-labelledby="active-orders-title"
      :aria-busy="store.loading.value || undefined"
    >
      <div class="orders-panel__heading">
        <div>
          <p class="page-kicker">
            В ПУТИ И В РАБОТЕ
          </p>
          <h2 id="active-orders-title">
            Активные заказы
          </h2>
        </div>
        <span class="orders-panel__count">{{ pluralizeOrders(activeOrders.length) }}</span>
      </div>

      <div
        v-if="store.loading.value"
        class="orders-state"
        role="status"
      >
        <span
          class="route-gate__spinner"
          aria-hidden="true"
        />
        <p>Загружаем заказы…</p>
      </div>
      <p
        v-else-if="problem"
        class="orders-state orders-state--compact"
      >
        Список заказов временно недоступен.
      </p>
      <div
        v-else-if="!store.orders.value.length"
        class="orders-state orders-state--empty"
      >
        <strong>Заказов пока нет</strong>
        <p>Добавьте товар — созданный заказ появится здесь.</p>
        <UiButton @click="addProduct">
          Добавить товар
        </UiButton>
      </div>
      <p
        v-else-if="!activeOrders.length"
        class="orders-state orders-state--compact"
      >
        Активных заказов нет.
      </p>

      <div
        v-if="!store.loading.value && activeOrders.length"
        class="orders-list"
      >
        <RouterLink
          v-for="order in activeOrders"
          :key="order.orderNumber"
          class="order-card"
          :to="{ name:'order-details', params:{ orderNumber:order.orderNumber } }"
        >
          <div
            class="order-card__visual"
            aria-hidden="true"
          >
            <img
              v-if="hasImage(order)"
              :src="order.imageUrl"
              alt=""
              referrerpolicy="no-referrer"
              @error="markImageFailed(order.orderNumber)"
            >
            <span v-else>◇</span>
          </div>

          <div class="order-card__summary">
            <div class="order-card__meta">
              <span class="order-card__number">{{ order.orderNumber }}</span>
              <span class="order-card__status">
                {{ status(order).upperStatusName }}
              </span>
            </div>
            <h3>{{ productName(order) }}</h3>
            <p class="order-card__domain">
              {{ storeName(order) }} · {{ quantityText(order.quantity) }}
            </p>
            <p class="order-card__details">
              <span>Создан {{ createdAt(order.createdAt) }}</span>
              <span>Срок доставки уточняется</span>
            </p>

            <div class="order-card__progress">
              <div class="order-card__progress-labels">
                <span>Заказ оформлен</span>
                <strong>{{ status(order).name }}</strong>
                <span>Доставка</span>
              </div>
              <div
                class="order-card__progress-track"
                role="progressbar"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuenow="store.progressFor(order.status)"
                :aria-label="`Выполнение заказа ${order.orderNumber}`"
              >
                <span :style="{ width:`${store.progressFor(order.status)}%` }" />
              </div>
            </div>
          </div>

          <div
            class="order-card__price"
            :class="{ 'order-card__price--empty':!order.sellerPrice }"
          >
            <template v-if="order.sellerPrice">
              <small>Цена продавца</small>
              <strong>{{ sellerPrice(order) }}</strong>
            </template>
            <span
              class="order-card__action"
              aria-hidden="true"
            >→</span>
          </div>
        </RouterLink>
      </div>
    </section>

    <section
      v-if="!store.loading.value && historyOrders.length"
      class="orders-panel orders-panel--history"
      aria-labelledby="history-orders-title"
    >
      <div class="orders-panel__heading">
        <div>
          <p class="page-kicker">
            ИСТОРИЯ
          </p>
          <h2 id="history-orders-title">
            Завершённые и отменённые заказы
          </h2>
        </div>
        <span class="orders-panel__count">{{ pluralizeOrders(historyOrders.length) }}</span>
      </div>

      <div class="orders-list">
        <RouterLink
          v-for="order in historyOrders"
          :key="order.orderNumber"
          class="order-card"
          :to="{ name:'order-details', params:{ orderNumber:order.orderNumber } }"
        >
          <div
            class="order-card__visual"
            aria-hidden="true"
          >
            <img
              v-if="hasImage(order)"
              :src="order.imageUrl"
              alt=""
              referrerpolicy="no-referrer"
              @error="markImageFailed(order.orderNumber)"
            >
            <span v-else>◇</span>
          </div>
          <div class="order-card__summary">
            <div class="order-card__meta">
              <span class="order-card__number">{{ order.orderNumber }}</span>
              <span class="order-card__status">
                {{ status(order).upperStatusName }}
              </span>
            </div>
            <h3>{{ productName(order) }}</h3>
            <p class="order-card__domain">
              {{ storeName(order) }} · {{ quantityText(order.quantity) }}
            </p>
            <p class="order-card__details">
              <span>Создан {{ createdAt(order.createdAt) }}</span>
              <span>Срок доставки уточняется</span>
            </p>
          </div>
          <div
            class="order-card__price"
            :class="{ 'order-card__price--empty':!order.sellerPrice }"
          >
            <template v-if="order.sellerPrice">
              <small>Цена продавца</small>
              <strong>{{ sellerPrice(order) }}</strong>
            </template>
            <span
              class="order-card__action"
              aria-hidden="true"
            >→</span>
          </div>
        </RouterLink>
      </div>
    </section>
  </main>
</template>
