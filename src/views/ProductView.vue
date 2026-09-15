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
  normalizeProblem,
  presentProblem,
  presentProblemTitle
} from '../errors/problem.js'
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
const previewLoading = ref(false)
const previewReady = ref(false)
const submitting = ref(false)
const authOpen = ref(false)
const quantityProblem = ref('')
const commentProblem = ref('')
let mounted = false
let previewOperation = 0
let submissionOperation = 0
let resumeRunning = false
let releaseConsentNoticeSuppression = null

const draft = computed(() => drafts.draft.value)
const sourceUrl = computed(() => draft.value?.sourceUrl || '')
const quantity = computed({
  get:() => draft.value?.quantity || '',
  set:value => {
    quantityProblem.value = ''
    drafts.update({ quantity:String(value) })
  }
})
const comment = computed({
  get:() => draft.value?.comment || '',
  set:value => {
    commentProblem.value = ''
    drafts.update({ comment:String(value) })
  }
})
const error = computed(() => problem.value ? presentProblem(problem.value) : '')
const errorTitle = computed(() => presentProblemTitle(problem.value))
const busy = computed(() => previewLoading.value || submitting.value)

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

function values() {
  quantityProblem.value = ''
  commentProblem.value = ''
  const parsedQuantity = Number(quantity.value)
  if (!/^\d+$/u.test(quantity.value) || !Number.isSafeInteger(parsedQuantity)
    || parsedQuantity <= 0 || parsedQuantity > 2147483647) {
    quantityProblem.value = 'Количество должно быть положительным числом'
  }
  if (comment.value.length > 2000) commentProblem.value = 'Комментарий не должен превышать 2000 символов'
  if (quantityProblem.value || commentProblem.value || !draft.value) return null
  return { sourceUrl:sourceUrl.value, quantity:parsedQuantity, comment:comment.value.trim() }
}

async function loadPreview() {
  if (!draft.value) {
    await router.replace({ name:'home' })
    return
  }
  const ownOperation = ++previewOperation
  previewLoading.value = true
  previewReady.value = false
  problem.value = null
  try {
    let validated
    await session.previewOrder(sourceUrl.value, () => currentPreview(ownOperation), value => {
      validated = validateProductPreview(value)
    })
    if (!currentPreview(ownOperation) || !validated) return
    if (!drafts.setCanonicalSourceUrl(validated.sourceUrl)) throw createInternalProblem('protocolError')
    previewReady.value = true
  } catch (value) {
    if (currentPreview(ownOperation)) problem.value = normalizeProblem(value)
  } finally {
    if (currentPreview(ownOperation)) previewLoading.value = false
  }
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
  const payload = values()
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

    let ops
    await session.orderRequest('/api/v1/orders/ops', {}, isCurrent, value => {
      ops = validateOrderOps(value)
    })
    if (!isCurrent() || !ops) return
    const idempotencyKey = drafts.ensureIdempotencyKey()
    if (!idempotencyKey) return
    let order
    await session.createOrder(payload, idempotencyKey, isCurrent, value => {
      order = validateCreatedOrder(value, ops, payload)
    })
    if (!isCurrent() || !order) return
    drafts.clear()
    showOrderCreated(customerId, order.orderNumber)
    await router.replace({ name:'orders' })
  } catch (value) {
    if (!isCurrent()) return
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
  if (!values() || busy.value) return
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
        <p class="page-kicker">
          ТОВАР
        </p>
        <h1>Проверим товар вручную</h1>
        <p>Укажите количество и при необходимости добавьте уточнение.</p>
      </div>
    </header>

    <UiAlert
      v-if="problem"
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
      v-if="previewLoading"
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
      v-else-if="previewReady && draft"
      class="product-fallback"
      novalidate
      @submit.prevent="submit"
    >
      <UiAlert
        title="Проверим по ссылке"
        tone="info"
      >
        Не получилось получить данные о товаре автоматически. Проверим его по ссылке.
      </UiAlert>

      <div class="product-source">
        <span>Ссылка на товар</span>
        <a
          :href="sourceUrl"
          target="_blank"
          rel="noopener noreferrer"
        >{{ sourceUrl }}</a>
      </div>

      <div class="product-form-grid">
        <UiField
          v-model="quantity"
          name="quantity"
          label="Количество"
          type="number"
          inputmode="numeric"
          min="1"
          step="1"
          required
          :disabled="busy"
          :errors="quantityProblem ? [quantityProblem] : []"
        />
        <UiField
          v-model="comment"
          name="comment"
          label="Комментарий / уточнение"
          hint="Необязательно"
          multiline
          :rows="4"
          maxlength="2000"
          :disabled="busy"
          :errors="commentProblem ? [commentProblem] : []"
        />
      </div>

      <div class="product-actions">
        <UiButton
          type="submit"
          variant="primary"
          :loading="submitting"
          :disabled="previewLoading"
        >
          Отправить на расчёт
        </UiButton>
        <UiButton
          type="button"
          variant="secondary"
          :disabled="busy"
          @click="changeProduct"
        >
          Изменить ссылку
        </UiButton>
      </div>
    </form>

    <PhoneAuthDialog
      :model-value="authOpen"
      @update:model-value="updateAuthentication"
      @authenticated="authenticated"
    />
  </main>
</template>
