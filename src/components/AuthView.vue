<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, ref, watch } from 'vue'

import {
  CORE_PROBLEM_TYPES,
  createInternalProblem,
  normalizeProblem,
  presentProblem,
  problemFieldErrors
} from '../errors/problem.js'
import { useConsents } from '../stores/consents.js'
import { useSession } from '../stores/session.js'
import { LEGAL_DOCUMENT_KIND } from '../consentFormatting.js'

const { notice, requestCode, verifyCode } = useSession()
const consentStore = useConsents()
const termsDocument = ref(null)
const pdDocument = ref(null)
const onboardingToken = ref('')
const appIcon = '/sarafan-gzhel-icon.png'
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
const error = computed(() => problem.value
  ? presentProblem(problem.value, {
      detailsByType: isRegistration.value
        ? {}
        : {
            [CORE_PROBLEM_TYPES.customerNotFound]: 'Пользователь с таким телефоном не найден. Выберите регистрацию.'
          }
    })
  : notice.value)
const phoneErrors = computed(() => problemFieldErrors(problem.value, 'phone'))
const codeErrors = computed(() => problemFieldErrors(problem.value, 'code'))
const termsErrors = computed(() => problemFieldErrors(problem.value, 'termsAccepted'))
const personalDataErrors = computed(() => problemFieldErrors(problem.value, 'personalDataAccepted'))

watch(mode, async () => {
  step.value = 'phone'
  code.value = ''
  problem.value = null
  termsAccepted.value = false
  personalDataAccepted.value = false
  onboardingToken.value = ''
  consentRetryFingerprint = ''
  consentRetryKey = ''
  if (mode.value === 'register') await loadDocuments()
})

async function loadDocuments() {
  problem.value = null
  termsDocument.value = null
  pdDocument.value = null
  busy.value = true
  try {
    const [terms, pd] = await Promise.all([
      consentStore.current(LEGAL_DOCUMENT_KIND.USER_AGREEMENT),
      consentStore.current(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)
    ])
    termsDocument.value = terms.document
    pdDocument.value = pd.document
    if (!terms.document || !pd.document) throw createInternalProblem('invalidInput', { detail:'Нет действующих документов для регистрации.' })
  } catch (error) { problem.value = normalizeProblem(error) }
  finally { busy.value = false }
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
  return { termsAccepted:termsAccepted.value, termsDocumentId:termsDocument.value?.id,
    personalDataConsent:{ documentId:pdDocument.value?.id, contentHash:pdDocument.value?.contentHash, decision:'grant', categories:[], idempotencyKey:consentRetryKey } }
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
    problem.value = createInternalProblem('invalidInput', { detail:'Прочитайте документы и отдельно подтвердите условия и согласие до отправки телефона.' })
    return
  }
  phone.value = normalizedPhone
  busy.value = true
  problem.value = null
  try {
    const receipt = await requestCode(normalizedPhone, mode.value, isRegistration.value ? consentPayload(normalizedPhone) : {})
    if (isRegistration.value && (typeof receipt?.onboardingToken !== 'string' || receipt.onboardingToken.length < 32)) throw createInternalProblem('protocolError')
    onboardingToken.value = receipt?.onboardingToken || ''
    step.value = 'code'
  } catch (value) {
    problem.value = normalizeProblem(value)
    if (['https://sarafan.sw.consulting/problems/consent-version-changed', 'https://sarafan.sw.consulting/problems/onboarding-consent-expired'].includes(problem.value.type)) {
      step.value = 'phone'
      termsAccepted.value = false
      personalDataAccepted.value = false
      onboardingToken.value = ''
      await loadDocuments()
    }
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
  } catch (value) {
    problem.value = normalizeProblem(value)
    if (['https://sarafan.sw.consulting/problems/consent-version-changed', 'https://sarafan.sw.consulting/problems/onboarding-consent-expired'].includes(problem.value.type)) {
      step.value = 'phone'
      termsAccepted.value = false
      personalDataAccepted.value = false
      onboardingToken.value = ''
      await loadDocuments()
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="auth-shell">
    <div
      class="auth-scene"
      aria-hidden="true"
    >
      <div class="auth-scene__copy">
        <span>Международные покупки</span>
        <p>
          Из магазина —<br>
          <em>прямо к вам</em>
        </p>
        <small>
          Выбирайте товары по всему миру.<br>
          Мы позаботимся обо всём остальном.
        </small>
      </div>

      <div class="auth-route">
        <span class="auth-route__line" />
        <span class="auth-route__stop auth-route__stop--store">
          <i />
          магазин
        </span>
        <span class="auth-route__stop auth-route__stop--warehouse">
          <i />
          проверка
        </span>
        <span class="auth-route__stop auth-route__stop--home">
          <i />
          у вашей двери
        </span>
      </div>

      <svg
        class="auth-ornament"
        viewBox="0 0 360 286"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M184 292C178 247 211 228 207 188C204 154 180 143 184 109C187 85 205 69 226 58" />
        <path d="M185 233C149 223 132 199 133 168C134 144 147 126 164 114" />
        <path d="M207 188C237 181 254 162 259 137C264 112 255 91 239 77" />
        <path d="M135 168C109 164 91 148 84 126C77 103 84 81 100 65" />
        <path
          d="M226 58C211 48 207 31 217 18C229 28 234 43 226 58Z"
          fill="currentColor"
        />
        <path
          d="M226 58C240 45 258 45 270 57C259 70 243 72 226 58Z"
          fill="currentColor"
        />
        <path
          d="M100 65C84 58 76 43 81 28C98 33 108 47 100 65Z"
          fill="currentColor"
        />
        <path
          d="M100 65C114 54 132 56 141 70C129 81 113 80 100 65Z"
          fill="currentColor"
        />
        <path
          d="M164 114C148 106 142 91 148 77C164 83 172 98 164 114Z"
          fill="currentColor"
        />
        <path
          d="M259 137C275 124 294 125 305 139C292 152 274 151 259 137Z"
          fill="currentColor"
        />
        <circle
          cx="226"
          cy="58"
          r="8"
        />
        <circle
          cx="100"
          cy="65"
          r="7"
        />
        <circle
          cx="164"
          cy="114"
          r="6"
        />
      </svg>
    </div>

    <section
      class="auth-card"
      aria-labelledby="auth-title"
    >
      <div class="auth-brand">
        <img
          :src="appIcon"
          alt=""
        >
        <div>
          <strong>Сарафан</strong>
          <span>покупки по всему миру</span>
        </div>
      </div>

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
        <div>
          <span class="section-kicker">Личный кабинет</span>
          <h1 id="auth-title">
            {{ isRegistration ? 'Создайте аккаунт' : 'Рады видеть снова' }}
          </h1>
          <p>Укажите телефон — мы отправим одноразовый код для безопасного входа.</p>
        </div>
        <div
          v-if="isRegistration"
          class="consent-list"
        >
          <v-checkbox
            v-model="termsAccepted"
            hide-details
            label="Я принимаю условия использования сервиса"
            :disabled="busy"
            :error-messages="termsErrors"
          />
          <v-checkbox
            v-model="personalDataAccepted"
            hide-details
            label="Я согласен на обработку персональных данных"
            :disabled="busy"
            :error-messages="personalDataErrors"
          />
          <p>
            <a
              v-if="termsDocument"
              :href="`#legal/${termsDocument.id}`"
            >Условия · версия {{ termsDocument.displayVersion }}</a>
          </p>
          <p>
            <a
              v-if="pdDocument"
              :href="`#legal/${pdDocument.id}`"
            >Согласие на персональные данные · версия {{ pdDocument.displayVersion }}</a>
          </p>
          <v-btn
            :disabled="busy"
            @click="loadDocuments"
          >
            Обновить документы
          </v-btn>
        </div>
        <v-text-field
          v-model="phone"
          name="phone"
          label="Номер телефона"
          placeholder="+7 999 123-45-67"
          autocomplete="tel"
          inputmode="tel"
          variant="outlined"
          :disabled="busy"
          :error-messages="phoneErrors"
        />
        <p
          v-if="error"
          class="form-error"
          role="alert"
        >
          {{ error }}
        </p>
        <v-btn
          type="submit"
          color="primary"
          size="large"
          block
          :loading="busy"
        >
          Получить код
        </v-btn>
      </form>

      <form
        v-else
        class="auth-form"
        @submit.prevent="submitCode"
      >
        <div>
          <span class="section-kicker">Подтверждение</span>
          <h1 id="auth-title">
            Введите код
          </h1>
          <p>Код отправлен на {{ phone }}.</p>
        </div>
        <v-text-field
          v-model="code"
          name="code"
          label="Код подтверждения"
          autocomplete="one-time-code"
          inputmode="numeric"
          maxlength="16"
          variant="outlined"
          :disabled="busy"
          :error-messages="codeErrors"
        />

        <p
          v-if="error"
          class="form-error"
          role="alert"
        >
          {{ error }}
        </p>
        <v-btn
          type="submit"
          color="primary"
          size="large"
          block
          :loading="busy"
        >
          {{ isRegistration ? 'Зарегистрироваться' : 'Войти' }}
        </v-btn>
        <button
          class="auth-back"
          type="button"
          :disabled="busy"
          @click="step = 'phone'"
        >
          Изменить номер телефона
        </button>
      </form>
    </section>
  </main>
</template>
