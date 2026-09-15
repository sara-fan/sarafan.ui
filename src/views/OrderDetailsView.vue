<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import UiAlert from '../components/ui/UiAlert.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiField from '../components/ui/UiField.vue'
import { createInternalProblem, normalizeProblem, presentProblem, presentProblemTitle } from '../errors/problem.js'
import { formatMoneyAmount } from '../moneyFormatting.js'
import { validateCustomerOrder, validateOrderOps } from '../stores/orders.js'
import { useSession } from '../stores/session.js'

const route = useRoute()
const router = useRouter()
const session = useSession()
const order = ref(null)
const ops = ref(null)
const problem = ref(null)
const loading = ref(false)
let generation = 0

const error = computed(() => problem.value ? presentProblem(problem.value) : '')
const errorTitle = computed(() => presentProblemTitle(problem.value))
const status = computed(() => ops.value?.statuses.find(item => item.value === order.value?.status))
const product = computed(() => order.value?.product)
const sourceHost = computed(() => {
  if (!order.value) return ''
  try { return new globalThis.URL(order.value.sourceUrl).hostname }
  catch { return '' }
})

function orderId() {
  const value = String(route.params.orderId ?? '')
  if (!/^[1-9]\d*$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}
function display(value) { return value?.trim() || 'Не указано' }
function createdAt(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'
  }).format(new Date(value))
}
function sellerPrice(value) {
  if (!value) return 'Не указано'
  const currency = ops.value?.currencies.find(item => item.value === value.currency)
  return `${formatMoneyAmount(value.amount)} ${currency?.name || ''}`.trim()
}
function goBack() { return router.push({ name:'orders' }) }

async function load() {
  const requestGeneration = ++generation
  const customerId = session.customer.value?.id
  const expectedId = orderId()
  const isCurrent = () => requestGeneration === generation
    && customerId === session.customer.value?.id && expectedId === orderId()
  problem.value = null
  order.value = null
  ops.value = null
  if (expectedId === null) {
    problem.value = createInternalProblem('invalidInput')
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
    await session.orderRequest(`/api/v1/orders/${expectedId}`, {}, isCurrent, value => {
      validatedOrder = validateCustomerOrder(value, validatedOps, expectedId)
    })
    if (!isCurrent()) return
    ops.value = validatedOps
    order.value = validatedOrder
  } catch (value) {
    if (isCurrent()) problem.value = normalizeProblem(value, { detail:'Не удалось загрузить заказ' })
  } finally {
    if (requestGeneration === generation) loading.value = false
  }
}

const stopWatch = watch(
  [() => route.params.orderId, () => session.customer.value?.id],
  ([currentOrderId, currentCustomerId], [previousOrderId, previousCustomerId] = []) => {
    if (currentOrderId === previousOrderId && currentCustomerId === previousCustomerId) return
    void load()
  },
  { immediate:true, flush:'sync' }
)

onBeforeUnmount(() => {
  generation++
  stopWatch()
})
</script>

<template>
  <main class="page-container order-details-view">
    <header class="page-heading order-details-heading">
      <div>
        <button
          type="button"
          class="product-back"
          :disabled="loading"
          @click="goBack"
        >
          ← Мои заказы
        </button>
        <h1>{{ order ? `Заказ ${order.orderNumber}` : 'Заказ' }}</h1>
        <p v-if="order">
          {{ status?.name }} · создан {{ createdAt(order.createdAt) }}
        </p>
      </div>
      <UiButton
        v-if="order"
        :loading="loading"
        @click="load"
      >
        Обновить
      </UiButton>
    </header>

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
      <section
        v-if="order.showReviewFields"
        class="order-review-card"
        aria-labelledby="order-product-title"
      >
        <div class="order-review-card__heading">
          <div>
            <p class="page-kicker">
              НА ПРОВЕРКЕ
            </p>
            <h2 id="order-product-title">
              Товар
            </h2>
          </div>
          <a
            :href="order.sourceUrl"
            target="_blank"
            rel="noopener noreferrer"
          >Страница товара</a>
        </div>
        <p class="order-review-card__notice">
          Проверим данные в течение двух часов. Стоимость заказа уточняется.
        </p>
        <div class="order-review-fields">
          <UiField
            :model-value="order.sourceUrl"
            label="Исходная ссылка"
            readonly
            class="order-review-fields__wide"
          />
          <UiField
            :model-value="display(product.productName)"
            label="Название товара, как на сайте"
            readonly
            class="order-review-fields__wide"
          />
          <UiField
            :model-value="display(product.storeName)"
            label="Магазин"
            readonly
          />
          <UiField
            :model-value="sellerPrice(product.sellerPrice)"
            label="Цена за единицу"
            readonly
          />
          <UiField
            :model-value="product.quantity"
            label="Количество"
            readonly
          />
          <UiField
            model-value="Стоимость уточняется"
            label="Стоимость"
            readonly
          />
          <UiField
            :model-value="display(product.color)"
            label="Цвет, как на сайте"
            readonly
          />
          <UiField
            :model-value="display(product.size)"
            label="Размер"
            readonly
          />
          <UiField
            :model-value="display(product.comment)"
            label="Комментарий"
            readonly
            multiline
            :rows="4"
            class="order-review-fields__wide"
          />
        </div>
      </section>

      <section
        v-else
        class="order-summary-card"
        aria-labelledby="order-product-title"
      >
        <div class="order-review-card__heading">
          <div>
            <p class="page-kicker">
              ТОВАР
            </p>
            <h2 id="order-product-title">
              {{ display(product.productName) }}
            </h2>
          </div>
          <a
            :href="order.sourceUrl"
            target="_blank"
            rel="noopener noreferrer"
          >Страница товара</a>
        </div>
        <dl class="order-summary-grid">
          <div>
            <dt>Магазин</dt>
            <dd>{{ display(product.storeName) }}</dd>
          </div>
          <div>
            <dt>Цена за единицу</dt>
            <dd>{{ sellerPrice(product.sellerPrice) }}</dd>
          </div>
          <div>
            <dt>Количество</dt>
            <dd>{{ product.quantity }}</dd>
          </div>
          <div>
            <dt>Сайт продавца</dt>
            <dd>{{ sourceHost }}</dd>
          </div>
          <div v-if="product.color">
            <dt>Цвет</dt>
            <dd>{{ product.color }}</dd>
          </div>
          <div v-if="product.size">
            <dt>Размер</dt>
            <dd>{{ product.size }}</dd>
          </div>
          <div
            v-if="product.comment"
            class="order-summary-grid__wide"
          >
            <dt>Комментарий</dt>
            <dd>{{ product.comment }}</dd>
          </div>
        </dl>
      </section>
    </template>
  </main>
</template>
