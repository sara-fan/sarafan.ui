<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { useValidationFocus, validationFields } from '../validationFocus.js'
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'

import FeaturedStores from '../components/FeaturedStores.vue'
import StoreCatalogueNotice from '../components/StoreCatalogueNotice.vue'
import PublicInfoBlock from '../components/PublicInfoBlock.vue'
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
            Закажите товар — остальное сделаем мы
          </h1>
          <p class="home-hero__lead">
            Вставьте ссылку на товар из американского интернет-магазина и получите предварительный расчёт.
          </p>
        </div>
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
        <p class="product-entry__note">
          До расчёта нам не нужны ваши контактные данные.
        </p>
      </div>
      <FeaturedStores />
    </section>

    <StoreCatalogueNotice class="page-container" />

    <section
      class="home-steps"
      aria-labelledby="steps-title"
    >
      <p class="page-kicker">
        КАК ЭТО РАБОТАЕТ
      </p>
      <h2 id="steps-title">
        Три понятных шага
      </h2>
      <ol>
        <li><span>1</span><div><strong>Отправьте ссылку</strong><p>На товар из интернет-магазина США.</p></div></li>
        <li><span>2</span><div><strong>Подтвердите расчёт</strong><p>Покажем стоимость товара, выкупа и доставки.</p></div></li>
        <li><span>3</span><div><strong>Получите заказ</strong><p>Организуем оплату, логистику и выдачу в России.</p></div></li>
      </ol>
    </section>

    <PublicInfoBlock />
  </main>
</template>
