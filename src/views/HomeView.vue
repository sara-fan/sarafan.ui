<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { useValidationFocus, validationFields } from '../validationFocus.js'
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'

import FeaturedStores from '../components/FeaturedStores.vue'
import StoreCatalogueNotice from '../components/StoreCatalogueNotice.vue'
import UiAlert from '../components/ui/UiAlert.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiField from '../components/ui/UiField.vue'
import { normalizeProblem, presentProblem, presentProblemTitle } from '../errors/problem.js'
import { normalizeProductAddress } from '../productAddress.js'
import { validateOrderOps } from '../stores/orders.js'
import { useProductDraft } from '../stores/productDraft.js'
import { useSession } from '../stores/session.js'

const focusRoot = ref(null)

const router = useRouter()
const session = useSession()
const draftStore = useProductDraft()
const sourceUrl = ref(draftStore.draft.value?.sourceUrl ?? '')
const sourceProblem = ref('')
const problem = ref(null)
const loading = ref(false)
let operations = null
let mounted = true
let operation = 0
const sourceErrors = computed(() => sourceProblem.value ? [sourceProblem.value] : [])
const error = computed(() => problem.value ? presentProblem(problem.value) : '')
const errorTitle = computed(() => presentProblemTitle(problem.value))

async function loadOperations(ownOperation) {
  if (operations) return operations
  let validated
  await session.orderRequest('/api/v1/orders/ops', {}, () => mounted && operation === ownOperation, value => {
    validated = validateOrderOps(value)
  })
  if (!mounted || operation !== ownOperation) return null
  operations = validated
  return operations
}

async function beginAction() {
  if (loading.value) return
  sourceProblem.value = ''
  problem.value = null
  if (!sourceUrl.value.trim()) {
    sourceProblem.value = 'Вставьте ссылку на товар'
    return
  }
  if (!normalizeProductAddress(sourceUrl.value)) {
    sourceProblem.value = 'Проверьте ссылку на товар и попробуйте ещё раз'
    return
  }
  const ownOperation = ++operation
  loading.value = true
  try {
    const loadedOperations = await loadOperations(ownOperation)
    if (!loadedOperations) return
    const normalized = normalizeProductAddress(sourceUrl.value, loadedOperations.productSourceUrl)
    if (!normalized || !draftStore.start(normalized)) {
      sourceProblem.value = 'Проверьте ссылку на товар и попробуйте ещё раз'
      return
    }
    await router.push({ name: 'product' })
  } catch (value) {
    if (mounted && operation === ownOperation) problem.value = normalizeProblem(value)
  } finally {
    if (mounted && operation === ownOperation) loading.value = false
  }
}

onBeforeUnmount(() => {
  mounted = false
  ++operation
})
function begin(...args) { return focusAfter(() => beginAction(...args), () => sourceProblem.value ? ['sourceUrl'] : validationFields(problem.value)) }

const focusAfter = useValidationFocus(focusRoot, { context:() => null, ready:() => !loading.value })
</script>

<template>
  <main class="home-view">
    <section
      class="home-hero"
      aria-labelledby="home-title"
    >
      <div class="home-hero__primary">
        <div class="home-hero__copy">
          <p class="page-kicker">
            ПОКУПКИ ИЗ США
          </p>
          <h1 id="home-title">
            <span>Закажите товар — </span><span>остальное <span class="home-hero__headline-tail">сделаем мы</span></span>
          </h1>
          <p class="home-hero__lead">
            Вставьте ссылку на товар из американского интернет-магазина и получите предварительный расчёт
          </p>
        </div>
        <div class="home-hero__entry">
          <UiAlert
            v-if="problem"
            :title="errorTitle"
          >
            {{ error }}
          </UiAlert>
          <form
            ref="focusRoot"
            class="product-entry"
            novalidate
            @submit.prevent="begin"
          >
            <UiField
              v-model="sourceUrl"
              name="sourceUrl"
              label="Ссылка на товар"
              type="text"
              placeholder="https://store.com/product"
              autocomplete="url"
              inputmode="url"
              required
              :disabled="loading"
              :errors="sourceErrors"
              @update:model-value="sourceProblem = ''; problem = null"
            />
            <UiButton
              type="submit"
              variant="primary"
              :loading="loading"
            >
              Рассчитать стоимость
            </UiButton>
          </form>
        </div>
        <ul class="home-hero__benefits">
          <li>
            <svg
              viewBox="0 0 48 48"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path d="M24 4 40 10v12c0 10-6 17-16 22C14 39 8 32 8 22V10L24 4Z" />
              <path d="m17 24 5 5 10-11" />
            </svg>
            <span>Надёжная доставка<br>с трекингом</span>
          </li>
          <li>
            <svg
              viewBox="0 0 48 48"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <rect
                x="4"
                y="9"
                width="40"
                height="30"
                rx="5"
              />
              <path d="M4 19h40M10 29h11" />
              <circle
                cx="35"
                cy="30"
                r="5"
              />
              <path d="m33 30 2 2 3-4" />
            </svg>
            <span>Прозрачные условия<br>и честная стоимость</span>
          </li>
          <li>
            <svg
              viewBox="0 0 48 48"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path d="m24 4 18 10v20L24 44 6 34V14L24 4Z" />
              <path d="M6 14 24 24l18-10M24 24v20M15 9l18 10" />
            </svg>
            <span>Тысячи товаров<br>из США</span>
          </li>
        </ul>
      </div>
      <FeaturedStores />
    </section>

    <StoreCatalogueNotice class="page-container" />

    <section
      class="home-steps"
      aria-labelledby="steps-title"
    >
      <div class="home-steps__heading">
        <h2 id="steps-title">
          Три понятных шага
        </h2>
        <p>Лёгкий и прозрачный процесс — от ссылки до получения заказа.</p>
      </div>
      <ol>
        <li>
          <span class="home-steps__number">1</span>
          <div class="home-steps__copy">
            <strong>Отправьте ссылку</strong>
            <p>На товар из американского интернет-магазина.</p>
          </div>
          <img
            class="home-steps__illustration"
            :src="'/step-link.svg'"
            alt=""
            aria-hidden="true"
          >
        </li>
        <li>
          <span class="home-steps__number">2</span>
          <div class="home-steps__copy">
            <strong>Подтвердите расчёт</strong>
            <p>Покажем стоимость товара, выкупа и доставки.</p>
          </div>
          <img
            class="home-steps__illustration"
            :src="'/step-confirm.svg'"
            alt=""
            aria-hidden="true"
          >
        </li>
        <li>
          <span class="home-steps__number">3</span>
          <div class="home-steps__copy">
            <strong>Получите заказ</strong>
            <p>Организуем оплату, логистику и выдачу в России.</p>
          </div>
          <img
            class="home-steps__illustration"
            :src="'/step-delivery.svg'"
            alt=""
            aria-hidden="true"
          >
        </li>
      </ol>
    </section>
  </main>
</template>
