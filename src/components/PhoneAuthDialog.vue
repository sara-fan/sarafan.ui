<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, nextTick, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import { BRAND_ICON_URL } from '../branding.js'
import {
  CORE_PROBLEM_TYPES,
  createInternalProblem,
  normalizeProblem,
  presentProblem,
  problemFieldErrors
} from '../errors/problem.js'
import { useConsents } from '../stores/consents.js'
import { useSession } from '../stores/session.js'
import UiAlert from './ui/UiAlert.vue'
import UiButton from './ui/UiButton.vue'
import UiDialog from './ui/UiDialog.vue'
import UiField from './ui/UiField.vue'
import UiSelectionControl from './ui/UiSelectionControl.vue'

const props = defineProps({ modelValue: { type: Boolean, default: true } })
const emit = defineEmits(['update:modelValue'])
const session = useSession()
const consentStore = useConsents()
const step = ref('phone')
const phone = ref('')
const code = ref('')
const resolution = ref(null)
const termsDocument = ref(null)
const pdDocument = ref(null)
const onboardingToken = ref('')
const termsAccepted = ref(false)
const personalDataAccepted = ref(false)
const busy = ref(false)
const problem = ref(null)
const codeField = ref(null)
let consentRetryFingerprint = ''
let consentRetryKey = ''
let operationGeneration = 0
let codeRequestAbortController = null
let verifyAbortController = null

const agreementKind = computed(() => consentStore.kindByAlias('user-agreement'))
const personalDataKind = computed(() => consentStore.kindByAlias('personal-data-consent'))
const requiresAgreement = computed(() => Number.isInteger(agreementKind.value)
  && resolution.value?.requiredDocumentKinds.includes(agreementKind.value))
const requiresPersonalData = computed(() => Number.isInteger(personalDataKind.value)
  && resolution.value?.requiredDocumentKinds.includes(personalDataKind.value))
const isRegistration = computed(() => resolution.value?.nextStep === session.flowValue('registration'))
const dialogTitle = computed(() => ({
  phone: 'Вход или регистрация',
  requirements: isRegistration.value ? 'Создайте аккаунт' : 'Продолжите вход',
  code: 'Введите код'
})[step.value])
const error = computed(() => problem.value ? presentProblem(problem.value) : session.notice.value)
const phoneErrors = computed(() => problemFieldErrors(problem.value, 'phone'))
const codeErrors = computed(() => problemFieldErrors(problem.value, 'code'))
const termsErrors = computed(() => problemFieldErrors(problem.value, 'termsAccepted'))
const personalDataErrors = computed(() => problemFieldErrors(problem.value, 'personalDataConsent'))
const termsDescribedBy = computed(() => [
  termsDocument.value ? 'authentication-terms-document' : null,
  termsErrors.value.length ? 'authentication-terms-error' : null
].filter(Boolean).join(' ') || undefined)
const personalDataDescribedBy = computed(() => [
  pdDocument.value ? 'authentication-personal-document' : null,
  personalDataErrors.value.length ? 'authentication-personal-error' : null
].filter(Boolean).join(' ') || undefined)

function resetAfterPhone() {
  step.value = 'phone'
  code.value = ''
  resolution.value = null
  termsDocument.value = null
  pdDocument.value = null
  onboardingToken.value = ''
  termsAccepted.value = false
  personalDataAccepted.value = false
  problem.value = null
  consentRetryFingerprint = ''
  consentRetryKey = ''
}

function cancelVerification() {
  verifyAbortController?.abort()
  verifyAbortController = null
}

function cancelCodeRequest() {
  codeRequestAbortController?.abort()
  codeRequestAbortController = null
}

function invalidateOperation() {
  operationGeneration++
  cancelCodeRequest()
  cancelVerification()
  return operationGeneration
}

watch(() => props.modelValue, open => {
  invalidateOperation()
  busy.value = false
  if (open) {
    phone.value = ''
    resetAfterPhone()
  }
})

watch([step, busy, () => props.modelValue], async ([currentStep, isBusy, open]) => {
  if (!open || isBusy || currentStep !== 'code') return
  await nextTick()
  if (props.modelValue && !busy.value && step.value === 'code') {
    codeField.value?.$el?.querySelector('input')?.focus()
  }
}, { flush:'post' })

const currentOperation = operation => props.modelValue && operation === operationGeneration

async function requestCodeForOperation(resolvedPhone, consents, operation) {
  cancelCodeRequest()
  const controller = new globalThis.AbortController()
  codeRequestAbortController = controller
  try {
    return await session.requestCode(
      resolvedPhone,
      consents,
      () => currentOperation(operation),
      controller.signal
    )
  } finally {
    if (codeRequestAbortController === controller) codeRequestAbortController = null
  }
}

async function loadRequiredDocuments(value, operation) {
  await consentStore.ensureOps()
  if (!currentOperation(operation)) return false
  const required = value.requiredDocumentKinds
  const agreement = agreementKind.value
  const personalData = personalDataKind.value
  if (required.some(kind => !consentStore.kindName(kind))) throw createInternalProblem('protocolError')
  if (value.nextStep === session.flowValue('agreement')
      && (required.length !== 1 || required[0] !== agreement)
    || value.nextStep === session.flowValue('registration')
      && (!required.includes(personalData)
        || required.some(kind => kind !== agreement && kind !== personalData))) {
    throw createInternalProblem('protocolError')
  }
  const requests = required.map(kind => consentStore.current(kind))
  const results = await Promise.all(requests)
  if (!currentOperation(operation)) return false
  const byKind = new Map(results.map(result => [result.document?.kind, result.document]))
  const needsAgreement = required.includes(agreement)
  const needsPersonalData = required.includes(personalData)
  termsDocument.value = needsAgreement ? byKind.get(agreement) || null : null
  pdDocument.value = needsPersonalData ? byKind.get(personalData) || null : null
  if ((needsAgreement && !termsDocument.value) || (needsPersonalData && !pdDocument.value)) {
    throw createInternalProblem('invalidInput', { detail: 'Нет действующих документов для продолжения.' })
  }
  return true
}

function validateResolution(value) {
  const codeStep = session.flowValue('code')
  const agreementStep = session.flowValue('agreement')
  const registrationStep = session.flowValue('registration')
  if (value.nextStep === codeStep && value.requiredDocumentKinds.length === 0) return
  if (value.nextStep === agreementStep && value.requiredDocumentKinds.length === 1) return
  if (value.nextStep === registrationStep && value.requiredDocumentKinds.length >= 1) return
  throw createInternalProblem('protocolError')
}

async function continueResolution(value, resolvedPhone, operation) {
  validateResolution(value)
  resolution.value = value
  if (value.nextStep === session.flowValue('code')) {
    const receipt = await requestCodeForOperation(resolvedPhone, {}, operation)
    if (!currentOperation(operation) || !receipt) return
    if (receipt.onboardingToken !== null) throw createInternalProblem('protocolError')
    step.value = 'code'
    return
  }
  if (await loadRequiredDocuments(value, operation) && currentOperation(operation)) step.value = 'requirements'
}

async function resolveCurrentPhone(operation) {
  const resolvedPhone = phone.value
  problem.value = null
  resolution.value = null
  termsDocument.value = null
  pdDocument.value = null
  termsAccepted.value = false
  personalDataAccepted.value = false
  onboardingToken.value = ''
  consentRetryFingerprint = ''
  consentRetryKey = ''
  const value = await session.resolvePhone(resolvedPhone)
  if (currentOperation(operation)) await continueResolution(value, resolvedPhone, operation)
}

function consentPayload() {
  const payload = {}
  if (requiresAgreement.value) {
    payload.termsAccepted = true
    payload.termsDocumentId = termsDocument.value.id
  }
  if (requiresPersonalData.value) {
    const fingerprint = JSON.stringify([phone.value, pdDocument.value.id, pdDocument.value.contentHash])
    if (fingerprint !== consentRetryFingerprint) {
      consentRetryFingerprint = fingerprint
      consentRetryKey = globalThis.crypto.randomUUID()
    }
    payload.personalDataConsent = {
      documentId: pdDocument.value.id,
      contentHash: pdDocument.value.contentHash,
      decision: 'grant',
      categories: [],
      idempotencyKey: consentRetryKey
    }
  }
  return payload
}

function needsRestart(value) {
  return [
    CORE_PROBLEM_TYPES.consentVersionChanged,
    CORE_PROBLEM_TYPES.invalidAuthRequest,
    CORE_PROBLEM_TYPES.onboardingConsentExpired,
    CORE_PROBLEM_TYPES.authenticationRequirementsChanged
  ].includes(value?.type)
}

async function restartFlow(value, operation) {
  resetAfterPhone()
  busy.value = true
  problem.value = normalizeProblem(value)
  try {
    await resolveCurrentPhone(operation)
  } catch (restartProblem) {
    if (currentOperation(operation)) problem.value = normalizeProblem(restartProblem)
  }
}

async function submitPhone() {
  const normalizedPhone = phone.value.trim()
  if (!normalizedPhone) {
    problem.value = createInternalProblem('invalidInput', {
      detail: 'Введите номер телефона',
      errors: { phone: ['Введите номер телефона'] }
    })
    return
  }
  phone.value = normalizedPhone
  const operation = invalidateOperation()
  busy.value = true
  problem.value = null
  try {
    await resolveCurrentPhone(operation)
  } catch (value) {
    if (!currentOperation(operation)) return
    if (needsRestart(value)) await restartFlow(value, operation)
    else problem.value = normalizeProblem(value)
  } finally {
    if (currentOperation(operation)) busy.value = false
  }
}

async function submitRequirements() {
  const errors = {}
  if (requiresAgreement.value && !termsAccepted.value) errors.termsAccepted = ['Примите условия использования сервиса']
  if (requiresPersonalData.value && !personalDataAccepted.value) {
    errors.personalDataConsent = ['Дайте согласие на обработку персональных данных']
  }
  if (Object.keys(errors).length) {
    problem.value = createInternalProblem('invalidInput', {
      detail: 'Подтвердите необходимые документы.',
      errors
    })
    return
  }

  const operation = invalidateOperation()
  busy.value = true
  problem.value = null
  try {
    const receipt = await requestCodeForOperation(phone.value, consentPayload(), operation)
    if (!currentOperation(operation) || !receipt) return
    onboardingToken.value = receipt.onboardingToken
    step.value = 'code'
  } catch (value) {
    if (!currentOperation(operation)) return
    if (needsRestart(value)) await restartFlow(value, operation)
    else problem.value = normalizeProblem(value)
  } finally {
    if (currentOperation(operation)) busy.value = false
  }
}

async function submitCode() {
  const normalizedCode = code.value.trim()
  if (!normalizedCode) {
    problem.value = createInternalProblem('invalidInput', {
      detail: 'Введите код подтверждения',
      errors: { code: ['Введите код подтверждения'] }
    })
    return
  }
  const operation = invalidateOperation()
  const controller = new globalThis.AbortController()
  verifyAbortController = controller
  busy.value = true
  problem.value = null
  try {
    const verifiedCustomer = await session.verifyCode(
      {
        phone: phone.value,
        code: normalizedCode,
        ...(onboardingToken.value ? { onboardingToken:onboardingToken.value } : {})
      },
      () => currentOperation(operation),
      controller.signal
    )
    if (!verifiedCustomer) return
    emit('update:modelValue', false)
  } catch (value) {
    if (!currentOperation(operation)) return
    if (needsRestart(value)) {
      await restartFlow(value, operation)
    } else {
      problem.value = normalizeProblem(value)
      if (problem.value.type === CORE_PROBLEM_TYPES.invalidCode) {
        code.value = ''
      }
    }
  } finally {
    if (verifyAbortController === controller) verifyAbortController = null
    if (currentOperation(operation)) busy.value = false
  }
}
</script>

<template>
  <UiDialog
    :model-value="modelValue"
    :title="dialogTitle"
    title-id="phone-auth-title"
    max-width="480"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #header>
      <img
        class="auth-dialog__brand"
        :src="BRAND_ICON_URL"
        alt=""
        aria-hidden="true"
      >
    </template>

    <form
      v-if="step === 'phone'"
      class="auth-form"
      @submit.prevent="submitPhone"
    >
      <p>Укажите телефон. Если аккаунт ещё не создан или отключён, мы предложим регистрацию.</p>
      <UiField
        v-model="phone"
        name="phone"
        label="Номер телефона"
        placeholder="+7 999 123-45-67"
        autocomplete="tel"
        inputmode="tel"
        :disabled="busy"
        :errors="phoneErrors"
      />
      <UiAlert
        v-if="error"
        class="form-error"
        :title="problem?.title"
      >
        {{ error }}
      </UiAlert>
      <UiButton
        type="submit"
        variant="primary"
        block
        :loading="busy"
      >
        Продолжить
      </UiButton>
    </form>

    <form
      v-else-if="step === 'requirements'"
      class="auth-form"
      @submit.prevent="submitRequirements"
    >
      <p v-if="isRegistration">
        Для номера {{ phone }} нужна регистрация. Подтвердите необходимые документы.
      </p>
      <p v-else>
        Чтобы продолжить вход для {{ phone }}, примите актуальное пользовательское соглашение.
      </p>
      <div class="consent-registration">
        <div
          v-if="requiresAgreement"
          class="consent-registration__item"
        >
          <UiSelectionControl
            id="authentication-terms"
            :model-value="termsAccepted"
            :disabled="busy"
            :error="termsErrors.length > 0"
            :aria-describedby="termsDescribedBy"
            @update:model-value="termsAccepted = $event"
          >
            Я принимаю условия использования сервиса
            <small>Пользовательское соглашение · версия {{ termsDocument?.displayVersion }}</small>
          </UiSelectionControl>
          <RouterLink
            id="authentication-terms-document"
            class="consent-document-link"
            :to="{ name: 'legal-document', params: { documentRef: termsDocument.id } }"
            @click="emit('update:modelValue', false)"
          >
            Открыть пользовательское соглашение
          </RouterLink>
          <p
            v-if="termsErrors.length"
            id="authentication-terms-error"
            class="consent-field-error"
            role="alert"
          >
            {{ termsErrors.join(' ') }}
          </p>
        </div>

        <div
          v-if="requiresPersonalData"
          class="consent-registration__item"
        >
          <UiSelectionControl
            id="authentication-personal-data"
            :model-value="personalDataAccepted"
            :disabled="busy"
            :error="personalDataErrors.length > 0"
            :aria-describedby="personalDataDescribedBy"
            @update:model-value="personalDataAccepted = $event"
          >
            Я даю отдельное согласие на обработку персональных данных
            <small>Согласие на обработку персональных данных · версия {{ pdDocument?.displayVersion }}</small>
          </UiSelectionControl>
          <RouterLink
            id="authentication-personal-document"
            class="consent-document-link"
            :to="{ name: 'legal-document', params: { documentRef: pdDocument.id } }"
            @click="emit('update:modelValue', false)"
          >
            Открыть согласие на обработку персональных данных
          </RouterLink>
          <p
            v-if="personalDataErrors.length"
            id="authentication-personal-error"
            class="consent-field-error"
            role="alert"
          >
            {{ personalDataErrors.join(' ') }}
          </p>
        </div>
      </div>
      <UiAlert
        v-if="error"
        class="form-error"
        :title="problem?.title"
      >
        {{ error }}
      </UiAlert>
      <UiButton
        type="submit"
        variant="primary"
        block
        :loading="busy"
      >
        Получить код
      </UiButton>
    </form>

    <form
      v-else
      class="auth-form"
      @submit.prevent="submitCode"
    >
      <p>Код отправлен на {{ phone }}.</p>
      <UiField
        ref="codeField"
        v-model="code"
        name="code"
        label="Код подтверждения"
        autocomplete="one-time-code"
        inputmode="numeric"
        maxlength="16"
        :disabled="busy"
        :errors="codeErrors"
      />
      <UiAlert
        v-if="error"
        class="form-error"
        :title="problem?.title"
      >
        {{ error }}
      </UiAlert>
      <UiButton
        type="submit"
        variant="primary"
        block
        :loading="busy"
      >
        {{ isRegistration ? 'Зарегистрироваться' : 'Войти' }}
      </UiButton>
    </form>
  </UiDialog>
</template>
