<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import UiAlert from '../components/ui/UiAlert.vue'
import UiButton from '../components/ui/UiButton.vue'
import { normalizeProblem, presentProblem } from '../errors/problem.js'
import { createOrderStore } from '../stores/orders.js'
import { useSession } from '../stores/session.js'

const session = useSession()
const router = useRouter()
const store = createOrderStore(session)
const problem = ref(null)
const failedImages = ref(new Set())
let mounted = true

// Presentation-only positions for the decorative Figma track. They are not delivery percentages.
const PROGRESS_POSITION = Object.freeze({
  under_review:14,
  quote_ready:32,
  quote_expired:32,
  paid:48,
  purchasing_item:56,
  delivering_to_us_warehouse:64,
  delivered_to_us_warehouse:70,
  delivering_to_russia:78,
  delivered_to_russian_warehouse:86,
  delivering_in_russia:94,
  received:100,
  cancelled:100
})
const STATUS_TONE = Object.freeze({
  under_review:'review',
  quote_ready:'payment',
  quote_expired:'warning',
  in_progress:'transit',
  completed:'success',
  cancelled:'cancelled'
})
const CURRENCY_SYMBOLS = Object.freeze({ rub:'₽', usd:'$' })

const activeOrders = computed(() => store.orders.value.filter(order => {
  const alias = store.statusFor(order.status)?.upperStatusRouteAlias
  return alias !== 'completed' && alias !== 'cancelled'
}))
const historyOrders = computed(() => store.orders.value.filter(order => {
  const alias = store.statusFor(order.status)?.upperStatusRouteAlias
  return alias === 'completed' || alias === 'cancelled'
}))
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
function statusTone(order) { return STATUS_TONE[status(order)?.upperStatusRouteAlias] || 'review' }
function progressPosition(order) { return PROGRESS_POSITION[status(order)?.routeAlias] ?? 0 }
function productName(order) { return order.productName?.trim() || 'Товар уточняется' }
function storeName(order) { return order.storeName?.trim() || 'Магазин уточняется' }
function createdAt(value) {
  return new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'long', year:'numeric' }).format(new Date(value))
}
function sellerPrice(order) {
  if (!order.sellerPrice) return 'Уточняется'
  const currency = store.currencyFor(order.sellerPrice.currency)
  const formatted = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits:2, maximumFractionDigits:2
  }).format(order.sellerPrice.amount)
  const symbol = CURRENCY_SYMBOLS[currency?.routeAlias]
  return symbol ? `${symbol} ${formatted}` : `${formatted} ${currency.name}`
}
function hasImage(order) { return Boolean(order.imageUrl) && !failedImages.value.has(order.id) }
function markImageFailed(orderId) {
  failedImages.value = new Set([...failedImages.value, orderId])
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

onMounted(load)
onBeforeUnmount(() => {
  mounted = false
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
      v-if="problem"
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
          :key="order.id"
          class="order-card"
          :to="{ name:'order-details', params:{ orderId:order.id } }"
          :aria-label="`Открыть заказ ${order.orderNumber}`"
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
              @error="markImageFailed(order.id)"
            >
            <span v-else>◇</span>
          </div>

          <div class="order-card__summary">
            <div class="order-card__meta">
              <span class="order-card__number">{{ order.orderNumber }}</span>
              <span
                class="order-card__status"
                :class="`order-card__status--${statusTone(order)}`"
              >
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
                aria-hidden="true"
              >
                <span :style="{ width:`${progressPosition(order)}%` }" />
              </div>
            </div>
          </div>

          <div class="order-card__price">
            <small>Цена продавца</small>
            <strong>{{ sellerPrice(order) }}</strong>
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
            Завершённые заказы
          </h2>
        </div>
        <span class="orders-panel__count">{{ pluralizeOrders(historyOrders.length) }}</span>
      </div>

      <div class="orders-list">
        <RouterLink
          v-for="order in historyOrders"
          :key="order.id"
          class="order-card"
          :to="{ name:'order-details', params:{ orderId:order.id } }"
          :aria-label="`Открыть заказ ${order.orderNumber}`"
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
              @error="markImageFailed(order.id)"
            >
            <span v-else>◇</span>
          </div>
          <div class="order-card__summary">
            <div class="order-card__meta">
              <span class="order-card__number">{{ order.orderNumber }}</span>
              <span
                class="order-card__status"
                :class="`order-card__status--${statusTone(order)}`"
              >
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
          <div class="order-card__price">
            <small>Цена продавца</small>
            <strong>{{ sellerPrice(order) }}</strong>
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
