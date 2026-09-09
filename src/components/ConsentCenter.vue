<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useSession } from '../stores/session.js'
import { useConsents } from '../stores/consents.js'
import { LEGAL_DOCUMENT_KIND, CONSENT_STATUSES, moscowTime } from '../consentFormatting.js'
import { normalizeProblem, presentProblem, createInternalProblem } from '../errors/problem.js'
import UiButton from './ui/UiButton.vue'
import UiSelectionControl from './ui/UiSelectionControl.vue'
import UiDialog from './ui/UiDialog.vue'
import LegalDocumentReader from './LegalDocumentReader.vue'

const session = useSession()
const store = useConsents()
const route = useRoute()
const router = useRouter()
const { cookies, mine, ops, opsProblem, cookieProblem, personalProblem } = store
const cookieOpen = ref(false)
const personalOpen = ref(false)
const documentOpen = ref(false)
const document = ref(null)
const legalReader = ref(null)
const cookieDocument = ref(null)
const personalDocument = ref(null)
const categories = ref([])
const accepted = ref(false)
const problem = ref(null)
const cookieDocumentProblem = ref(null)
const busy = ref(false)
const cookieDocumentBusy = ref(false)
let documentEpoch = 0
let cookieDocumentEpoch = 0
let choiceKey = globalThis.crypto.randomUUID()
let choiceSignature = ''
let personalKey = globalThis.crypto.randomUUID()
let personalSignature = ''

const status = computed(() => mine.value?.statuses.find(item => item.kind === LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT))
const latestPersonalGrant = computed(() => (mine.value?.history || [])
  .filter(item => item.kind === LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT && item.decision === 'grant')
  .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))[0] || null)
const withdrawalPending = computed(() => mine.value?.withdrawalRequest?.processed === false)
const cookieRequired = computed(() => !store.serviceAllowed.value)
const cookieCanRefuse = computed(() => !['refused', 'withdrawn'].includes(cookies.value?.status))
const cookieNeedsGrant = computed(() => cookies.value?.status !== 'current')
const cookieGrantCategories = computed(() => {
  const available = new Set(cookieDocument.value?.cookieCategories || [])
  return store.requiredCookieCategories().filter(category => available.has(category))
})
const canGrantCookies = computed(() => cookieGrantCategories.value.length > 0
  && cookieGrantCategories.value.every(category => categories.value.includes(category)))
const message = computed(() => problem.value ? presentProblem(problem.value) : '')
const cookieNoticeError = computed(() => {
  const value = problem.value || cookieDocumentProblem.value || cookieProblem.value || opsProblem.value
  return value ? presentProblem(value) : ''
})
const cookieNoticeTitle = computed(() => {
  if (cookieNoticeError.value && !cookieDocument.value) return 'Не удалось загрузить настройки куки'
  if (cookies.value?.status === 'refused') return 'Обязательные куки отклонены'
  if (cookies.value?.status === 'withdrawn') return 'Согласие на использование куки отозвано'
  if (cookies.value?.status === 'renewal-required') return 'Требуется новое согласие на использование куки'
  return 'Согласие на использование куки'
})
const cookieNoticeCopy = computed(() => {
  if (['refused', 'withdrawn'].includes(cookies.value?.status)) {
    return 'Сервис остаётся недоступен. Чтобы продолжить, заново выберите обязательную категорию и подтвердите согласие.'
  }
  if (cookies.value?.status === 'renewal-required') {
    return 'Документ изменился. Ознакомьтесь с актуальной версией и подтвердите обязательную категорию заново.'
  }
  return 'Для использования сервиса необходимо принять обязательные куки. Сначала выберите обязательную категорию.'
})

const label = value => CONSENT_STATUSES[value] || value
function resetChoice() { choiceKey = globalThis.crypto.randomUUID(); choiceSignature = '' }
function toggleCategory(category, selected) {
  categories.value = selected
    ? [...new Set([...categories.value, category])]
    : categories.value.filter(value => value !== category)
  resetChoice()
}

async function perform(action, onVersionChanged) {
  busy.value = true
  problem.value = null
  try { await action() }
  catch (error) {
    problem.value = normalizeProblem(error)
    if (problem.value.type === 'https://sarafan.sw.consulting/problems/consent-version-changed' && onVersionChanged) {
      try { await onVersionChanged() }
      catch (refreshError) { problem.value = normalizeProblem(refreshError) }
    }
  }
  finally { busy.value = false }
}

async function fetchCookieDocument(refreshStatus = false) {
  const epoch = ++cookieDocumentEpoch
  cookieDocumentBusy.value = true
  cookieDocumentProblem.value = null
  try {
    if (refreshStatus) await store.loadCookies()
    const result = (await store.current(LEGAL_DOCUMENT_KIND.COOKIE_CONSENT)).document
    if (!result) throw createInternalProblem('invalidInput', { detail:'Документ о куки пока не действует. Использование сервиса недоступно.' })
    if (epoch === cookieDocumentEpoch) cookieDocument.value = result
    return result
  } catch (error) {
    if (epoch === cookieDocumentEpoch) {
      cookieDocument.value = null
      cookieDocumentProblem.value = normalizeProblem(error)
    }
    throw error
  } finally {
    if (epoch === cookieDocumentEpoch) cookieDocumentBusy.value = false
  }
}

async function prepareCookieNotice(refreshStatus = false) {
  try { await fetchCookieDocument(refreshStatus) }
  catch { /* The notice presents a safe, recoverable error. */ }
}

async function openLegal(target = route.params.documentRef) {
  if (route.name === 'consents') {
    if (session.customer.value) await openPersonal()
    else await openCookies()
    return
  }
  if (route.name !== 'legal-document' || typeof target !== 'string') return
  const epoch = ++documentEpoch
  documentOpen.value = true
  document.value = null
  await perform(async () => {
    await store.ensureOps()
    const kind = store.kindByAlias(target)
    const result = kind !== undefined ? (await store.current(kind)).document : await store.read(target)
    if (!result) throw createInternalProblem('invalidInput', { detail:'Документ пока не действует.' })
    if (epoch === documentEpoch) document.value = result
  })
}

function closeLegal() {
  documentEpoch++
  documentOpen.value = false
  if (route.name === 'legal-document') router.replace({ name: 'home' })
  if (cookieRequired.value && !cookieDocument.value) prepareCookieNotice()
}

function printLegal() { legalReader.value?.printDocument() }

async function openCookies() {
  personalOpen.value = false
  cookieOpen.value = true
  categories.value = []
  resetChoice()
  await perform(() => fetchCookieDocument(true))
}

async function chooseCookies(decision) {
  await perform(async () => {
    let text = cookieDocument.value
    if (decision === 'withdraw' && cookies.value?.documentId) text = await store.read(cookies.value.documentId)
    if (!text) return
    const selected = decision === 'grant' ? categories.value : []
    const signature = JSON.stringify([text.id, text.contentHash, decision, [...selected].sort()])
    if (choiceSignature !== signature) resetChoice()
    choiceSignature = signature
    await store.decideCookies(text, decision, selected, choiceKey)
    resetChoice()
    categories.value = []
    cookieOpen.value = false
    if (route.name === 'consents') await router.replace({ name: 'home' })
  }, async () => {
    categories.value = []
    cookieDocument.value = null
    resetChoice()
    await fetchCookieDocument()
  })
}

async function showPersonal(refreshMine) {
  cookieOpen.value = false
  personalOpen.value = true
  accepted.value = false
  personalDocument.value = null
  await perform(async () => {
    if (refreshMine) await store.loadMine()
    personalDocument.value = (await store.current(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)).document
  })
}

async function openPersonal() { await showPersonal(true) }

function closePersonal() {
  personalOpen.value = false
  if (route.name === 'consents') router.replace({ name: 'home' })
}

async function grant() {
  if (!accepted.value || !personalDocument.value) return
  await perform(async () => {
    const signature = JSON.stringify([session.customer.value.id, personalDocument.value.id, personalDocument.value.contentHash])
    if (personalSignature !== signature) personalKey = globalThis.crypto.randomUUID()
    personalSignature = signature
    await store.grant(personalDocument.value, personalKey)
    personalSignature = ''
    accepted.value = false
  }, async () => {
    accepted.value = false
    personalDocument.value = null
    await store.loadMine()
    personalDocument.value = (await store.current(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)).document
  })
}

async function requestWithdrawal() { await perform(() => store.requestWithdrawal()) }

async function refreshOps() {
  await perform(async () => {
    await store.loadOps()
    if (cookieRequired.value) await fetchCookieDocument()
  })
}

async function visible() {
  if (globalThis.document.visibilityState !== 'visible') return
  await perform(async () => {
    await Promise.all([store.loadCookies(), store.loadMine()])
    if (cookieRequired.value) await fetchCookieDocument()
  })
}

watch(() => session.customer.value?.id, async (id, _previous, cleanup) => {
  let active = true
  cleanup(() => { active = false })
  store.resetCustomer()
  personalOpen.value = false
  personalDocument.value = null
  if (!id) return
  try {
    if (store.serviceAllowed.value) await store.associate()
    if (active) await store.loadMine()
    if (active && route.name === 'consents' && !personalOpen.value) await showPersonal(false)
  }
  catch (error) { if (active) problem.value = normalizeProblem(error) }
}, { immediate:true })

watch(cookieRequired, (required, previous) => {
  if (required && previous === false) {
    categories.value = []
    cookieDocument.value = null
    resetChoice()
    prepareCookieNotice()
  }
})

onMounted(async () => {
  if (route.name === 'consents' || route.name === 'legal-document') await openLegal()
  else await refreshOps()
  globalThis.addEventListener('focus', visible)
  globalThis.document.addEventListener('visibilitychange', visible)
})

watch(
  () => [route.name, route.params.documentRef],
  async ([name, target], _previous, cleanup) => {
    let active = true
    cleanup(() => { active = false })
    if (name === 'legal-document') {
      await openLegal(target)
      if (!active) documentEpoch++
    } else if (name === 'consents') {
      await openLegal()
    } else {
      documentEpoch++
      documentOpen.value = false
      personalOpen.value = false
    }
  }
)

onUnmounted(() => {
  documentEpoch++
  cookieDocumentEpoch++
  globalThis.removeEventListener('focus', visible)
  globalThis.document.removeEventListener('visibilitychange', visible)
  store.dispose()
})
</script>

<template>
  <section
    v-if="cookieRequired && !cookieOpen && !documentOpen && !personalOpen"
    class="cookie-notice"
    role="region"
    aria-labelledby="cookie-notice-title"
  >
    <h2 id="cookie-notice-title">
      {{ cookieNoticeTitle }}
    </h2>
    <p>{{ cookieNoticeCopy }}</p>
    <p
      v-if="cookieNoticeError"
      class="consent-alert"
      role="alert"
    >
      {{ cookieNoticeError }}
    </p>
    <div
      v-if="cookieDocument"
      class="cookie-notice__choices"
    >
      <UiSelectionControl
        v-for="category in cookieGrantCategories"
        :key="category"
        :model-value="categories.includes(category)"
        :disabled="busy"
        @update:model-value="toggleCategory(category, $event)"
      >
        {{ store.cookieCategoryName(category) }}
        <small>Необходимы для входа, безопасности и работы сервиса.</small>
      </UiSelectionControl>
    </div>
    <div class="cookie-notice__actions">
      <UiButton
        variant="primary"
        :disabled="busy || cookieDocumentBusy || !cookieDocument || !canGrantCookies"
        @click="chooseCookies('grant')"
      >
        Принять обязательные куки
      </UiButton>
      <UiButton
        v-if="cookieCanRefuse"
        variant="secondary"
        :disabled="busy || cookieDocumentBusy || !cookieDocument"
        @click="chooseCookies('refuse')"
      >
        Отказаться
      </UiButton>
      <UiButton
        variant="quiet"
        :disabled="busy"
        @click="openCookies"
      >
        Настроить куки
      </UiButton>
      <UiButton
        v-if="cookieNoticeError"
        variant="quiet"
        :disabled="busy || cookieDocumentBusy"
        @click="prepareCookieNotice(true)"
      >
        Повторить загрузку
      </UiButton>
    </div>
    <nav
      class="consent-utility-links cookie-notice__links"
      aria-label="Юридические документы"
    >
      <RouterLink
        v-for="item in ops?.kinds || []"
        :key="item.value"
        :to="{ name: 'legal-document', params: { documentRef: item.routeAlias } }"
      >
        {{ item.name }}
      </RouterLink>
      <button
        v-if="session.customer.value"
        type="button"
        class="consent-registration__retry"
        @click="openPersonal"
      >
        Мои согласия и обращения
      </button>
    </nav>
    <p
      v-if="personalProblem"
      class="consent-alert"
      role="alert"
    >
      {{ presentProblem(personalProblem) }}
    </p>
  </section>

  <UiDialog
    v-model="cookieOpen"
    title="Настройки куки"
    title-id="cookie-dialog-title"
  >
    <p
      v-if="message"
      class="consent-alert"
      role="alert"
    >
      {{ message }}
    </p>
    <section class="consent-section consent-section--soft">
      <h3>Состояние в этом браузере</h3>
      <dl class="consent-summary">
        <dt>Статус</dt>
        <dd><span class="consent-status">{{ label(cookies?.status || 'unavailable') }}</span></dd>
        <dt>Выбранные категории</dt>
        <dd>{{ cookies?.categories?.length ? cookies.categories.map(store.cookieCategoryName).join(', ') : 'Нет' }}</dd>
      </dl>
      <p>Выбор относится только к этому браузеру и не переносится на другие устройства.</p>
    </section>
    <section
      v-if="cookieDocument"
      class="consent-section"
    >
      <h3>Актуальный документ</h3>
      <LegalDocumentReader
        :document="cookieDocument"
      />
    </section>
    <section
      v-if="cookieNeedsGrant && cookieDocument"
      class="consent-section"
    >
      <h3>Новое подтверждение</h3>
      <p>Выберите все обязательные категории. Ранее сделанный выбор не считается подтверждением этой версии.</p>
      <UiSelectionControl
        v-for="category in cookieGrantCategories"
        :key="category"
        :model-value="categories.includes(category)"
        :disabled="busy"
        @update:model-value="toggleCategory(category, $event)"
      >
        {{ store.cookieCategoryName(category) }}
      </UiSelectionControl>
    </section>
    <template #actions>
      <UiButton
        v-if="cookieNeedsGrant"
        variant="primary"
        :disabled="busy || !cookieDocument || !canGrantCookies"
        @click="chooseCookies('grant')"
      >
        Принять обязательные куки
      </UiButton>
      <UiButton
        v-if="cookieNeedsGrant && cookieCanRefuse"
        variant="secondary"
        :disabled="busy || !cookieDocument"
        @click="chooseCookies('refuse')"
      >
        Отказаться
      </UiButton>
      <UiButton
        v-if="cookies?.status === 'current' && cookies?.documentId"
        variant="danger"
        :disabled="busy"
        @click="chooseCookies('withdraw')"
      >
        Отозвать согласие на использование куки
      </UiButton>
      <UiButton
        variant="quiet"
        :disabled="busy"
        @click="openCookies"
      >
        Обновить документ
      </UiButton>
      <UiButton
        variant="secondary"
        @click="cookieOpen = false"
      >
        Закрыть
      </UiButton>
    </template>
  </UiDialog>

  <UiDialog
    :model-value="personalOpen"
    title="Мои согласия и обращения"
    title-id="personal-consent-dialog-title"
    @update:model-value="!$event && closePersonal()"
  >
    <p
      v-if="message"
      class="consent-alert"
      role="alert"
    >
      {{ message }}
    </p>
    <section class="consent-section consent-section--soft">
      <h3>Согласие на обработку персональных данных</h3>
      <dl class="consent-summary">
        <dt>Статус</dt>
        <dd><span class="consent-status">{{ label(status?.status || 'unavailable') }}</span></dd>
        <dt>Принятая версия</dt>
        <dd>{{ latestPersonalGrant?.displayVersion || '—' }}</dd>
        <dt>Дата принятия</dt>
        <dd>{{ moscowTime(latestPersonalGrant?.at) }}</dd>
        <dt>Актуальная версия</dt>
        <dd>{{ personalDocument?.displayVersion || '—' }}</dd>
      </dl>
    </section>
    <section
      v-if="personalDocument"
      class="consent-section"
    >
      <h3>Актуальный документ</h3>
      <LegalDocumentReader
        :document="personalDocument"
      />
    </section>
    <section
      v-if="status?.status !== 'current' && personalDocument"
      class="consent-section"
    >
      <h3>Подтверждение согласия</h3>
      <UiSelectionControl
        :model-value="accepted"
        :disabled="busy"
        @update:model-value="accepted = $event"
      >
        Я даю отдельное согласие на хранение и обработку персональных данных по этому документу
      </UiSelectionControl>
    </section>
    <section class="consent-section">
      <h3>Прекращение использования системы</h3>
      <p>Запрос будет записан для ручной обработки сотрудниками. Его отправка сама по себе не отключает учётную запись, не удаляет данные и не изменяет состояние согласия.</p>
      <UiButton
        variant="danger"
        block
        :disabled="busy || withdrawalPending"
        @click="requestWithdrawal"
      >
        Прекратить использовать систему и отозвать согласие на обработку персональных данных
      </UiButton>
      <p
        v-if="mine?.withdrawalRequest"
        class="withdrawal-record"
        role="status"
      >
        Запрос от {{ moscowTime(mine.withdrawalRequest.requestedAt) }} ·
        {{ mine.withdrawalRequest.processed ? 'Обработан' : 'Ожидает ручной обработки' }}
      </p>
    </section>
    <section class="consent-section">
      <h3>История</h3>
      <p>Записи куки связаны с аккаунтом в момент наблюдения. Они не разрешают куки на других устройствах.</p>
      <ol
        v-if="mine?.history?.length"
        class="consent-history"
      >
        <li
          v-for="event in mine.history"
          :key="event.id"
        >
          {{ store.kindName(event.kind) }} · {{ label(event.decision) }} · {{ moscowTime(event.at) }}
          <RouterLink :to="{ name: 'legal-document', params: { documentRef: event.documentId } }">
            Версия {{ event.displayVersion }}
          </RouterLink>
          <small v-if="event.associatedAt">Связано с аккаунтом {{ moscowTime(event.associatedAt) }}</small>
        </li>
      </ol>
      <p v-else>
        Записей пока нет.
      </p>
    </section>
    <template #actions>
      <UiButton
        v-if="status?.status !== 'current'"
        variant="primary"
        :disabled="busy || !personalDocument || !accepted"
        @click="grant"
      >
        Дать согласие
      </UiButton>
      <UiButton
        variant="quiet"
        :disabled="busy"
        @click="openPersonal"
      >
        Обновить
      </UiButton>
      <UiButton
        variant="secondary"
        @click="closePersonal"
      >
        Закрыть
      </UiButton>
    </template>
  </UiDialog>

  <UiDialog
    :model-value="documentOpen"
    :title="document?.title || 'Юридический документ'"
    hide-header
    @update:model-value="!$event && closeLegal()"
  >
    <p
      v-if="message"
      class="consent-alert"
      role="alert"
    >
      {{ message }}
    </p>
    <LegalDocumentReader
      v-if="document"
      ref="legalReader"
      :document="document"
    />
    <template #actions>
      <UiButton
        v-if="document"
        variant="secondary"
        @click="printLegal"
      >
        Печать
      </UiButton>
      <UiButton
        variant="secondary"
        @click="closeLegal"
      >
        Закрыть
      </UiButton>
    </template>
  </UiDialog>
</template>
