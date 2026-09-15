<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import PhoneAuthDialog from '../components/PhoneAuthDialog.vue'
import UiAlert from '../components/ui/UiAlert.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiField from '../components/ui/UiField.vue'
import {
  CORE_PROBLEM_TYPES,
  createInternalProblem,
  hasOnlyPresentedFieldErrors,
  normalizeProblem,
  presentProblem,
  presentProblemTitle,
  problemFieldErrors
} from '../errors/problem.js'
import { formatMoneyInput } from '../moneyFormatting.js'
import { PRODUCT_FIELDS, previewPrefill, priceCents, productFormErrors, productPayload } from '../orderProduct.js'
import { useConsents } from '../stores/consents.js'
import { showOrderCreated } from '../stores/orderNotices.js'
import { validateCreatedOrder, validateOrderOps, validateProductPreview } from '../stores/orders.js'
import { useProductDraft } from '../stores/productDraft.js'
import { useSession } from '../stores/session.js'

const router = useRouter()
const session = useSession()
const consents = useConsents()
const drafts = useProductDraft()
const problem = ref(null)
const ops = ref(null)
const previewLoading = ref(false)
const previewReady = ref(false)
const submitting = ref(false)
const authOpen = ref(false)
const attempted = ref(false)
const touched = ref(new Set())
let mounted = false
let previewOperation = 0
let submissionOperation = 0
let resumeRunning = false
let releaseConsentNoticeSuppression = null

const draft = computed(() => drafts.draft.value)
const sourceUrl = computed(() => draft.value?.sourceUrl || '')
const busy = computed(() => previewLoading.value || submitting.value)
const ratesUnavailable = computed(() => previewReady.value && ops.value && !ops.value.productLimits.valueLimit.available)
const localErrors = computed(() => draft.value && ops.value ? productFormErrors(draft.value, ops.value.productLimits) : {})
const pageProblem = computed(() => hasOnlyPresentedFieldErrors(problem.value, PRODUCT_FIELDS) ? null : problem.value)
const error = computed(() => pageProblem.value ? presentProblem(pageProblem.value) : '')
const errorTitle = computed(() => presentProblemTitle(pageProblem.value))
const previewNotice = computed(() => draft.value?.previewOutcome === 'recognized'
  ? 'Проверьте распознанные данные и при необходимости исправьте их.'
  : 'Не получилось получить все данные о товаре автоматически. Заполните их вручную.')

function fieldModel(name) {
  return computed({
    get:() => draft.value?.[name] ?? '',
    set:value => {
      touched.value = new Set([...touched.value, name])
      problem.value = null
      drafts.update({ [name]:String(value) })
    }
  })
}

const storeName = fieldModel('storeName')
const productName = fieldModel('productName')
const sellerPrice = fieldModel('sellerPrice')
const quantity = fieldModel('quantity')
const color = fieldModel('color')
const size = fieldModel('size')
const comment = fieldModel('comment')

function markTouched(name) {
  touched.value = new Set([...touched.value, name])
}

function blurSellerPrice() {
  markTouched('sellerPrice')
  const cents = priceCents(sellerPrice.value)
  const maximum = ops.value ? priceCents(ops.value.productLimits.maximumUnitPrice) : null
  if (cents !== null && maximum !== null && cents <= maximum) {
    drafts.update({ sellerPrice:formatMoneyInput(Number(cents) / 100) })
  }
}

function errorsFor(name) {
  const remote = problemFieldErrors(problem.value, name)
  if (remote.length) return remote
  return attempted.value || touched.value.has(name) ? localErrors.value[name] ?? [] : []
}

function currentPreview(value) {
  return mounted && value === previewOperation
}

function currentSubmission(value, customerId) {
  return mounted && value === submissionOperation && session.customer.value?.id === customerId
}

function acquireConsentProblemOwnership() {
  const previousRelease = releaseConsentNoticeSuppression
  releaseConsentNoticeSuppression = consents.acquireNoticeSuppression()
  previousRelease?.()
}

function releaseConsentProblemOwnership() {
  const release = releaseConsentNoticeSuppression
  releaseConsentNoticeSuppression = null
  release?.()
}

async function loadOperations(isCurrent) {
  let validated
  await session.orderRequest('/api/v1/orders/ops', {}, isCurrent, value => {
    validated = validateOrderOps(value)
  })
  return isCurrent() ? validated : null
}

async function loadPreview() {
  if (!draft.value) {
    await router.replace({ name:'home' })
    return
  }
  const ownOperation = ++previewOperation
  const isCurrent = () => currentPreview(ownOperation)
  previewLoading.value = true
  previewReady.value = false
  problem.value = null
  try {
    const loadedOps = await loadOperations(isCurrent)
    if (!loadedOps) return
    ops.value = loadedOps
    let validated
    await session.previewOrder(sourceUrl.value, isCurrent, value => {
      validated = validateProductPreview(value, loadedOps)
    })
    if (!isCurrent() || !validated) return
    const prefill = previewPrefill(validated.product, loadedOps.productLimits)
    if (!drafts.applyPreview(validated.sourceUrl, validated.outcome, prefill)) {
      throw createInternalProblem('protocolError')
    }
    previewReady.value = true
  } catch (value) {
    if (isCurrent()) problem.value = normalizeProblem(value)
  } finally {
    if (isCurrent()) previewLoading.value = false
  }
}

async function refreshLimits() {
  const ownOperation = previewOperation
  const isCurrent = () => currentPreview(ownOperation)
  previewLoading.value = true
  problem.value = null
  try {
    const loadedOps = await loadOperations(isCurrent)
    if (loadedOps) ops.value = loadedOps
  } catch (value) {
    if (isCurrent()) problem.value = normalizeProblem(value)
  } finally {
    if (isCurrent()) previewLoading.value = false
  }
}

function currentPayload() {
  attempted.value = true
  if (!draft.value || !ops.value || Object.keys(localErrors.value).length || ratesUnavailable.value) return null
  return productPayload(draft.value, ops.value.productLimits)
}

function openAuthentication() {
  drafts.markAuthenticationResume()
  authOpen.value = true
}

function updateAuthentication(open) {
  authOpen.value = open
  if (!open && draft.value?.resumeMode === 'authentication') drafts.clearResume()
}

async function authenticated() {
  authOpen.value = false
  drafts.clearResume()
  await submitAuthenticated()
}

async function requireConsent(customerId) {
  drafts.markConsentResume(customerId)
  await router.push({ name:'personal-consents', query:{ returnTo:'product-submit' } })
}

async function submitAuthenticated() {
  let payload = currentPayload()
  const customerId = session.customer.value?.id
  if (!payload || !customerId || submitting.value) return
  if (draft.value?.boundCustomerId && draft.value.boundCustomerId !== customerId) {
    drafts.clearResume()
    problem.value = createInternalProblem('identityChanged')
    return
  }

  const ownOperation = ++submissionOperation
  const isCurrent = () => currentSubmission(ownOperation, customerId)
  submitting.value = true
  problem.value = null
  acquireConsentProblemOwnership()
  try {
    const consentCurrent = await consents.hasCurrentPersonalData()
    if (!isCurrent()) return
    if (!consentCurrent) {
      releaseConsentProblemOwnership()
      await requireConsent(customerId)
      return
    }
    releaseConsentProblemOwnership()
    drafts.clearResume()

    const loadedOps = await loadOperations(isCurrent)
    if (!isCurrent() || !loadedOps) return
    ops.value = loadedOps
    payload = currentPayload()
    if (!payload) return
    const idempotencyKey = drafts.ensureIdempotencyKey()
    if (!idempotencyKey) return
    let order
    await session.createOrder(payload, idempotencyKey, isCurrent, value => {
      order = validateCreatedOrder(value, loadedOps, payload)
    })
    if (!isCurrent() || !order) return
    drafts.clear()
    showOrderCreated(customerId, order.orderNumber)
    await router.replace({ name:'orders' })
  } catch (value) {
    if (!isCurrent() && !session.isCurrentIdentityInvalidation(value)) return
    const normalized = normalizeProblem(value)
    if (normalized.type === CORE_PROBLEM_TYPES.personalDataConsentRequired) {
      releaseConsentProblemOwnership()
      await requireConsent(customerId)
    } else {
      problem.value = normalized
    }
  } finally {
    if (isCurrent()) submitting.value = false
  }
}

async function submit() {
  if (!currentPayload() || busy.value) return
  if (!drafts.ensureIdempotencyKey()) return
  if (!session.customer.value) {
    openAuthentication()
    return
  }
  await submitAuthenticated()
}

async function changeProduct() {
  ++previewOperation
  ++submissionOperation
  releaseConsentProblemOwnership()
  drafts.clear()
  await router.push({ name:'home' })
}

async function resume() {
  if (resumeRunning || !mounted || !previewReady.value || session.restoring.value || !draft.value) return
  resumeRunning = true
  try {
    if (draft.value.resumeMode === 'authentication') {
      if (session.customer.value) {
        drafts.clearResume()
        await submitAuthenticated()
      } else {
        authOpen.value = true
      }
    } else if (draft.value.resumeMode === 'consent') {
      if (draft.value.boundCustomerId === session.customer.value?.id) await submitAuthenticated()
      else drafts.clearResume()
    }
  } finally {
    resumeRunning = false
  }
}

watch(() => session.customer.value?.id, (customerId, previousCustomerId) => {
  if (customerId === previousCustomerId || !submitting.value) return
  ++submissionOperation
  submitting.value = false
  releaseConsentProblemOwnership()
  drafts.clearResume()
  problem.value = createInternalProblem('identityChanged')
}, { flush:'sync' })

watch([previewReady, session.restoring, () => session.customer.value?.id], resume)

onMounted(async () => {
  mounted = true
  await loadPreview()
  await resume()
})

onBeforeUnmount(() => {
  mounted = false
  previewOperation++
  submissionOperation++
  releaseConsentProblemOwnership()
})
</script>

<template>
  <main class="page-container product-view">
    <header class="page-heading product-heading">
      <div>
        <button
          type="button"
          class="product-back"
          :disabled="busy"
          @click="changeProduct"
        >
          ← Назад
        </button>
        <h1>Проверим товар по ссылке</h1>
        <p>Укажите данные о товаре, мы все проверим и пришлем расчет стоимости заказа в SMS</p>
      </div>
    </header>

    <UiAlert
      v-if="pageProblem"
      :title="errorTitle"
    >
      <p>{{ error }}</p>
      <UiButton
        v-if="!previewReady"
        :loading="previewLoading"
        @click="loadPreview"
      >
        Повторить
      </UiButton>
    </UiAlert>

    <section
      v-if="previewLoading && !previewReady"
      class="product-state"
      aria-label="Проверка ссылки"
      aria-live="polite"
    >
      <span
        class="route-gate__spinner"
        aria-hidden="true"
      />
      <p>Проверяем ссылку на товар…</p>
    </section>

    <form
      v-else-if="previewReady && draft && ops"
      class="product-review"
      novalidate
      @submit.prevent="submit"
    >
      <section class="product-review__form">
        <UiAlert
          :title="draft.previewOutcome === 'recognized' ? 'Проверьте товар' : 'Проверим по ссылке'"
          tone="info"
        >
          {{ previewNotice }}
        </UiAlert>

        <div class="product-review__fields">
          <div class="product-source-field">
            <UiField
              :model-value="sourceUrl"
              label="Исходная ссылка"
              readonly
            />
            <a
              :href="sourceUrl"
              target="_blank"
              rel="noopener noreferrer"
            >Открыть страницу товара</a>
          </div>
          <UiField
            v-model="productName"
            name="productName"
            label="Название товара, как на сайте"
            required
            :disabled="busy"
            :errors="errorsFor('productName')"
            @blur="markTouched('productName')"
          />
          <UiField
            v-model="storeName"
            name="storeName"
            label="Магазин"
            hint="Необязательно"
            :disabled="busy"
            :errors="errorsFor('storeName')"
            @blur="markTouched('storeName')"
          />
          <UiField
            v-model="sellerPrice"
            name="sellerPrice"
            label="Цена за единицу, USD"
            inputmode="decimal"
            required
            :disabled="busy"
            :errors="errorsFor('sellerPrice')"
            @blur="blurSellerPrice"
          />
          <UiField
            v-model="quantity"
            name="quantity"
            label="Количество"
            inputmode="numeric"
            required
            :disabled="busy"
            :errors="errorsFor('quantity')"
            @blur="markTouched('quantity')"
          />
          <UiField
            v-model="color"
            name="color"
            label="Цвет, как на сайте"
            hint="Необязательно"
            :disabled="busy"
            :errors="errorsFor('color')"
            @blur="markTouched('color')"
          />
          <UiField
            v-model="size"
            name="size"
            label="Размер"
            hint="Необязательно"
            :disabled="busy"
            :errors="errorsFor('size')"
            @blur="markTouched('size')"
          />
          <UiField
            v-model="comment"
            name="comment"
            label="Комментарий"
            hint="Необязательно"
            multiline
            :rows="4"
            :disabled="busy"
            :errors="errorsFor('comment')"
            class="product-comment-field"
            @blur="markTouched('comment')"
          />
        </div>
      </section>

      <aside class="product-review__summary">
        <span>Стоимость</span>
        <strong>Стоимость<br>уточняется</strong>
        <p>Рассчитаем её после проверки</p>
        <UiAlert
          v-if="ratesUnavailable"
          tone="info"
          title="Проверка лимита временно недоступна"
        >
          <p>Не удалось получить общую пару курсов USD/RUB и EUR/RUB.</p>
          <UiButton
            :loading="previewLoading"
            @click="refreshLimits"
          >
            Повторить
          </UiButton>
        </UiAlert>
        <UiButton
          type="submit"
          variant="primary"
          block
          :loading="submitting"
          :disabled="previewLoading || ratesUnavailable"
        >
          Отправить на проверку
        </UiButton>
      </aside>
    </form>

    <PhoneAuthDialog
      :model-value="authOpen"
      @update:model-value="updateAuthentication"
      @authenticated="authenticated"
    />
  </main>
</template>
