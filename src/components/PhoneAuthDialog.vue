<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import {
  CORE_PROBLEM_TYPES,
  createInternalProblem,
  normalizeProblem,
  presentProblem,
  problemFieldErrors
} from '../errors/problem.js'
import { LEGAL_DOCUMENT_KIND } from '../consentFormatting.js'
import { useConsents } from '../stores/consents.js'
import { useSession } from '../stores/session.js'
import UiAlert from './ui/UiAlert.vue'
import UiButton from './ui/UiButton.vue'
import UiDialog from './ui/UiDialog.vue'
import UiField from './ui/UiField.vue'
import UiSelectionControl from './ui/UiSelectionControl.vue'

defineProps({ modelValue: { type: Boolean, default: true } })
const emit = defineEmits(['update:modelValue'])
const { notice, requestCode, verifyCode } = useSession()
const consentStore = useConsents()
const termsDocument = ref(null)
const pdDocument = ref(null)
const onboardingToken = ref('')
const mode = ref('login')
const step = ref('phone')
const phone = ref('')
const code = ref('')
const termsAccepted = ref(false)
const personalDataAccepted = ref(false)
const busy = ref(false)
const problem = ref(null)
let consentRetryFingerprint = ''
let consentRetryKey = ''

const isRegistration = computed(() => mode.value === 'register')
const dialogTitle = computed(() => step.value === 'code'
  ? 'Введите код'
  : isRegistration.value ? 'Создайте аккаунт' : 'Рады видеть снова')
const error = computed(() => problem.value
  ? presentProblem(problem.value, {
      detailsByType: isRegistration.value
        ? {}
        : { [CORE_PROBLEM_TYPES.customerNotFound]: 'Пользователь с таким телефоном не найден. Выберите регистрацию.' }
    })
  : notice.value)
const phoneErrors = computed(() => problemFieldErrors(problem.value, 'phone'))
const codeErrors = computed(() => problemFieldErrors(problem.value, 'code'))
const termsErrors = computed(() => problemFieldErrors(problem.value, 'termsAccepted'))
const personalDataErrors = computed(() => problemFieldErrors(problem.value, 'personalDataAccepted'))
const termsDescribedBy = computed(() => [
  termsDocument.value ? 'registration-terms-document' : null,
  termsErrors.value.length ? 'registration-terms-error' : null
].filter(Boolean).join(' ') || undefined)
const personalDataDescribedBy = computed(() => [
  pdDocument.value ? 'registration-personal-document' : null,
  personalDataErrors.value.length ? 'registration-personal-error' : null
].filter(Boolean).join(' ') || undefined)

function resetFlow() {
  step.value = 'phone'
  code.value = ''
  problem.value = null
  termsAccepted.value = false
  personalDataAccepted.value = false
  onboardingToken.value = ''
  consentRetryFingerprint = ''
  consentRetryKey = ''
}

watch(mode, async () => {
  resetFlow()
  if (mode.value === 'register') await loadDocuments()
})

async function loadDocuments() {
  problem.value = null
  termsDocument.value = null
  pdDocument.value = null
  busy.value = true
  try {
    const [terms, personalData] = await Promise.all([
      consentStore.current(LEGAL_DOCUMENT_KIND.USER_AGREEMENT),
      consentStore.current(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)
    ])
    termsDocument.value = terms.document
    pdDocument.value = personalData.document
    if (!terms.document || !personalData.document) {
      throw createInternalProblem('invalidInput', { detail: 'Нет действующих документов для регистрации.' })
    }
  } catch (value) {
    problem.value = normalizeProblem(value)
  } finally {
    busy.value = false
  }
}

function consentPayload(normalizedPhone) {
  const fingerprint = JSON.stringify([
    normalizedPhone,
    termsDocument.value?.id,
    pdDocument.value?.id,
    pdDocument.value?.contentHash
  ])
  if (fingerprint !== consentRetryFingerprint) {
    consentRetryFingerprint = fingerprint
    consentRetryKey = globalThis.crypto.randomUUID()
  }
  return {
    termsAccepted: termsAccepted.value,
    termsDocumentId: termsDocument.value?.id,
    personalDataConsent: {
      documentId: pdDocument.value?.id,
      contentHash: pdDocument.value?.contentHash,
      decision: 'grant',
      categories: [],
      idempotencyKey: consentRetryKey
    }
  }
}

async function refreshDocumentsAfterConsentProblem() {
  resetFlow()
  await loadDocuments()
}

function isConsentProblem(value) {
  return [
    'https://sarafan.sw.consulting/problems/consent-version-changed',
    'https://sarafan.sw.consulting/problems/onboarding-consent-expired'
  ].includes(value.type)
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
  if (isRegistration.value && (!termsDocument.value || !pdDocument.value || !termsAccepted.value || !personalDataAccepted.value)) {
    problem.value = createInternalProblem('invalidInput', {
      detail: 'Прочитайте документы и отдельно подтвердите условия и согласие до отправки телефона.'
    })
    return
  }
  phone.value = normalizedPhone
  busy.value = true
  problem.value = null
  try {
    const receipt = await requestCode(normalizedPhone, mode.value, isRegistration.value ? consentPayload(normalizedPhone) : {})
    if (isRegistration.value && (typeof receipt?.onboardingToken !== 'string' || receipt.onboardingToken.length < 32)) {
      throw createInternalProblem('protocolError')
    }
    onboardingToken.value = receipt?.onboardingToken || ''
    step.value = 'code'
  } catch (value) {
    problem.value = normalizeProblem(value)
    if (isConsentProblem(problem.value)) await refreshDocumentsAfterConsentProblem()
  } finally {
    busy.value = false
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
  if (isRegistration.value && (!termsAccepted.value || !personalDataAccepted.value)) {
    problem.value = createInternalProblem('invalidInput', {
      detail: 'Для регистрации необходимо принять оба согласия',
      errors: {
        termsAccepted: ['Примите условия использования сервиса'],
        personalDataAccepted: ['Дайте согласие на обработку персональных данных']
      }
    })
    return
  }
  busy.value = true
  problem.value = null
  try {
    await verifyCode({
      phone: phone.value,
      purpose: mode.value,
      code: normalizedCode,
      termsAccepted: termsAccepted.value,
      onboardingToken: onboardingToken.value
    })
    emit('update:modelValue', false)
  } catch (value) {
    problem.value = normalizeProblem(value)
    if (isConsentProblem(problem.value)) await refreshDocumentsAfterConsentProblem()
  } finally {
    busy.value = false
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
    <div
      class="auth-tabs"
      role="tablist"
      aria-label="Способ входа"
    >
      <button
        type="button"
        role="tab"
        :disabled="busy"
        :aria-selected="mode === 'login'"
        :class="{ 'auth-tab--active': mode === 'login' }"
        @click="mode = 'login'"
      >
        Войти
      </button>
      <button
        type="button"
        role="tab"
        :disabled="busy"
        :aria-selected="mode === 'register'"
        :class="{ 'auth-tab--active': mode === 'register' }"
        @click="mode = 'register'"
      >
        Регистрация
      </button>
    </div>

    <form
      v-if="step === 'phone'"
      class="auth-form"
      @submit.prevent="submitPhone"
    >
      <p>Укажите телефон — мы отправим одноразовый код для безопасного входа.</p>
      <div
        v-if="isRegistration"
        class="consent-registration"
      >
        <div class="consent-registration__item">
          <UiSelectionControl
            id="registration-terms"
            :model-value="termsAccepted"
            :disabled="busy"
            :error="termsErrors.length > 0"
            :aria-describedby="termsDescribedBy"
            @update:model-value="termsAccepted = $event"
          >
            Я принимаю условия использования сервиса
            <small v-if="termsDocument">Пользовательское соглашение · версия {{ termsDocument.displayVersion }}</small>
          </UiSelectionControl>
          <RouterLink
            v-if="termsDocument"
            id="registration-terms-document"
            class="consent-document-link"
            :to="{ name: 'legal-document', params: { documentRef: termsDocument.id } }"
          >
            Открыть пользовательское соглашение
          </RouterLink>
          <p
            v-if="termsErrors.length"
            id="registration-terms-error"
            class="consent-field-error"
            role="alert"
          >
            {{ termsErrors.join(' ') }}
          </p>
        </div>
        <div class="consent-registration__item">
          <UiSelectionControl
            id="registration-personal-data"
            :model-value="personalDataAccepted"
            :disabled="busy"
            :error="personalDataErrors.length > 0"
            :aria-describedby="personalDataDescribedBy"
            @update:model-value="personalDataAccepted = $event"
          >
            Я даю отдельное согласие на обработку персональных данных
            <small v-if="pdDocument">Согласие на обработку персональных данных · версия {{ pdDocument.displayVersion }}</small>
          </UiSelectionControl>
          <RouterLink
            v-if="pdDocument"
            id="registration-personal-document"
            class="consent-document-link"
            :to="{ name: 'legal-document', params: { documentRef: pdDocument.id } }"
          >
            Открыть согласие на обработку персональных данных
          </RouterLink>
          <p
            v-if="personalDataErrors.length"
            id="registration-personal-error"
            class="consent-field-error"
            role="alert"
          >
            {{ personalDataErrors.join(' ') }}
          </p>
        </div>
        <UiButton
          class="consent-registration__retry"
          variant="quiet"
          :disabled="busy"
          @click="loadDocuments"
        >
          Обновить документы
        </UiButton>
      </div>
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
      <UiButton
        class="auth-back"
        variant="quiet"
        block
        :disabled="busy"
        @click="step = 'phone'"
      >
        Изменить номер телефона
      </UiButton>
    </form>
  </UiDialog>
</template>
