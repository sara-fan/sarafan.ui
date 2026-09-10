<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { LEGAL_DOCUMENT_KIND, CONSENT_STATUSES, documentNodes, isDocumentId, moscowTime } from '../consentFormatting.js'
import {
  createInternalProblem,
  isServiceUnavailableProblem,
  normalizeProblem,
  presentProblem
} from '../errors/problem.js'
import { useConsents } from '../stores/consents.js'
import { useSession } from '../stores/session.js'
import LegalDocumentReader from './LegalDocumentReader.vue'
import ServiceUnavailablePage from './ServiceUnavailablePage.vue'
import UiAlert from './ui/UiAlert.vue'
import UiButton from './ui/UiButton.vue'
import UiSelectionControl from './ui/UiSelectionControl.vue'

const props = defineProps({
  mode: {
    type: String,
    default: 'notice',
    validator: value => ['notice', 'consents', 'legal'].includes(value)
  },
  section: {
    type: String,
    default: 'auto',
    validator: value => ['auto', 'cookies', 'personal'].includes(value)
  }
})
const emit = defineEmits(['service-unavailable'])

const session = useSession()
const store = useConsents()
const route = useRoute()
const router = useRouter()
const { cookies, mine, ops, opsProblem, cookieProblem, personalProblem } = store
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
const cookieStatusLoads = ref(0)
let documentEpoch = 0
let cookieDocumentEpoch = 0
let choiceKey = globalThis.crypto.randomUUID()
let choiceSignature = ''
let personalKey = globalThis.crypto.randomUUID()
let personalSignature = ''
let lastAttempt = null
let operationEpoch = 0
let sessionEpoch = 0
let viewEpoch = 0
let mounted = false
let cookieRefreshPending = false
let legalBoundaryTimer = null
let cookieBoundaryTimer = null
let cookieBoundaryRefreshPending = null
let personalBoundary = null
let personalRefreshPending = null
let foregroundRefreshPending = false
let refreshQueueRunning = false

const alwaysCurrent = () => true
const currentPredicate = value => typeof value === 'function' ? value : alwaysCurrent

const authenticated = computed(() => Boolean(session.customer.value))
const personalPage = computed(() => props.mode === 'consents' && authenticated.value
  && props.section !== 'cookies')
const cookiePage = computed(() => props.mode === 'consents'
  && (props.section !== 'personal' || !authenticated.value))
const cookieViewCurrent = () => mounted && (props.mode === 'notice' || cookiePage.value)
const combinedPage = computed(() => cookiePage.value && personalPage.value)
const consentPageTitle = computed(() => {
  if (combinedPage.value) return 'Согласия'
  return cookiePage.value
    ? 'Согласие на использование куки'
    : 'Согласие на обработку персональных данных'
})
const consentPageCopy = computed(() => combinedPage.value
  ? 'Здесь можно управлять согласием на использование куки и согласием на обработку персональных данных.'
  : cookiePage.value
    ? 'Выбор действует только в этом браузере и не переносится на другие устройства.'
    : 'Здесь можно проверить актуальность согласия, историю документов и состояние обращения.')
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
const legalDocumentHasH1 = computed(() => {
  if (!document.value) return false
  try {
    const hasH1 = nodes => nodes.some(node => node && typeof node === 'object'
      && (node.type === 'h1' || (Array.isArray(node.children) && hasH1(node.children))))
    return hasH1(documentNodes(document.value.html))
  } catch { return false }
})
const prioritizedProblem = values => values.find(isServiceUnavailableProblem) || values.find(Boolean) || null
const activeProblem = computed(() => {
  if (props.mode === 'legal') return problem.value
  if (combinedPage.value) {
    return prioritizedProblem([
      problem.value,
      cookieDocumentProblem.value,
      cookieProblem.value,
      personalProblem.value,
      opsProblem.value
    ])
  }
  if (personalPage.value) {
    return prioritizedProblem([problem.value, personalProblem.value, opsProblem.value])
  }
  return prioritizedProblem([
    problem.value,
    cookieDocumentProblem.value,
    cookieProblem.value,
    personalProblem.value,
    opsProblem.value
  ])
})
const message = computed(() => activeProblem.value ? presentProblem(activeProblem.value) : '')
const serviceUnavailable = computed(() => isServiceUnavailableProblem(activeProblem.value))
const cookieNoticeError = computed(() => {
  const value = problem.value || cookieDocumentProblem.value || cookieProblem.value || personalProblem.value || opsProblem.value
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
function requireDocument(value, detail) {
  if (!value) throw createInternalProblem('invalidInput', { detail })
  if (!Number.isFinite(Date.parse(value.effectiveAt))) throw createInternalProblem('protocolError')
  documentNodes(value.html)
  return value
}
function nextChangeDelay(envelope) {
  if (envelope?.nextChangeAt == null) return null
  const delay = Date.parse(envelope.nextChangeAt) - Date.parse(envelope.serverNow)
  if (!Number.isFinite(delay) || delay <= 0) throw createInternalProblem('protocolError')
  return delay
}
function scheduleBoundary(delay, assign, action) {
  function schedule(remaining) {
    const chunk = Math.min(remaining, 2147483647)
    assign(globalThis.setTimeout(() => {
      if (remaining > chunk) schedule(remaining - chunk)
      else action()
    }, chunk))
  }
  schedule(delay)
}
function resetChoice() { choiceKey = globalThis.crypto.randomUUID(); choiceSignature = '' }
function resetPersonalChoice() { personalKey = globalThis.crypto.randomUUID(); personalSignature = '' }
function documentSignature(value) { return value ? `${value.id}:${value.contentHash}` : '' }
function toggleCategory(category, selected) {
  categories.value = selected
    ? [...new Set([...categories.value, category])]
    : categories.value.filter(value => value !== category)
  resetChoice()
}

function invalidateOperations() {
  operationEpoch++
  lastAttempt = null
  busy.value = false
}

async function perform(action, onVersionChanged, isCurrent = alwaysCurrent, retryAction = action) {
  if (!isCurrent()) return false
  const operation = ++operationEpoch
  const ownsOperation = () => operation === operationEpoch && isCurrent()
  let succeeded = false
  lastAttempt = { action:retryAction, onVersionChanged, isCurrent }
  busy.value = true
  problem.value = null
  try {
    await action(ownsOperation)
    if (!ownsOperation()) return false
    lastAttempt = null
    succeeded = true
  } catch (error) {
    if (!ownsOperation()) return false
    problem.value = normalizeProblem(error)
    if (problem.value.type === 'https://sarafan.sw.consulting/problems/consent-version-changed' && onVersionChanged) {
      try {
        await onVersionChanged(ownsOperation)
        if (ownsOperation()) {
          problem.value = null
          lastAttempt = null
        }
      }
      catch (refreshError) {
        if (ownsOperation()) {
          problem.value = normalizeProblem(refreshError)
          lastAttempt = { action:onVersionChanged, onVersionChanged:undefined, isCurrent }
        }
      }
    }
  } finally {
    if (ownsOperation()) busy.value = false
  }
  return succeeded
}

async function retry() {
  const epoch = sessionEpoch
  const isCurrent = () => mounted && epoch === sessionEpoch
  const attempt = lastAttempt
  if (attempt) {
    const attemptCurrent = () => isCurrent() && attempt.isCurrent()
    const succeeded = await perform(attempt.action, attempt.onVersionChanged, attemptCurrent)
    if (!isCurrent() || !serviceUnavailable.value || (!succeeded && !combinedPage.value)) return
  }
  if (props.mode !== 'legal' && problem.value && !cookieDocumentProblem.value
    && !cookieProblem.value && !personalProblem.value && store.serviceAllowed.value && session.customer.value) {
    const associated = await perform(() => store.associate(), undefined, isCurrent)
    if (!associated) return
  }
  if (props.mode === 'notice') await refreshNotice(isCurrent)
  else if (props.mode === 'legal') await openLegal(undefined, isCurrent)
  else if (combinedPage.value) {
    await openCookies(isCurrent)
    if (!isCurrent() || !personalPage.value) return
    await openPersonal(isCurrent)
  } else if (cookiePage.value && (cookieDocumentProblem.value || cookieProblem.value)) await openCookies(isCurrent)
  else if (personalPage.value) await openPersonal(isCurrent)
  else await openCookies(isCurrent)
}

async function loadCookieStatus() {
  cookieStatusLoads.value++
  try { await store.loadCookies() }
  finally { cookieStatusLoads.value-- }
}

async function fetchCookieDocument(refreshStatus = false, isCurrent = alwaysCurrent) {
  if (!isCurrent()) return null
  cookieRefreshPending = false
  cookieBoundaryRefreshPending = null
  globalThis.clearTimeout(cookieBoundaryTimer)
  cookieBoundaryTimer = null
  const epoch = ++cookieDocumentEpoch
  const ownsRequest = () => epoch === cookieDocumentEpoch && isCurrent()
  cookieDocumentBusy.value = true
  cookieDocumentProblem.value = null
  try {
    if (refreshStatus) await loadCookieStatus()
    if (!ownsRequest()) return null
    const envelope = await store.current(LEGAL_DOCUMENT_KIND.COOKIE_CONSENT)
    if (!ownsRequest()) return null
    const delay = nextChangeDelay(envelope)
    if (delay !== null) {
      const boundarySession = sessionEpoch
      const boundaryCurrent = () => cookieViewCurrent() && boundarySession === sessionEpoch
      scheduleBoundary(delay, value => { cookieBoundaryTimer = value }, () => {
        if (epoch !== cookieDocumentEpoch || !boundaryCurrent()) return
        cookieBoundaryRefreshPending = boundaryCurrent
        void drainQueuedRefreshes()
      })
    }
    const result = requireDocument(
      envelope.document,
      'Документ о куки пока не действует. Использование сервиса недоступно.'
    )
    if (!ownsRequest()) return null
    cookieDocument.value = result
    return result
  } catch (error) {
    if (!ownsRequest()) return null
    cookieDocument.value = null
    cookieDocumentProblem.value = normalizeProblem(error)
    throw error
  } finally {
    if (ownsRequest()) {
      cookieDocumentBusy.value = false
      cookieRefreshPending = false
    }
  }
}

async function prepareCookieNotice(refreshStatus = false, isCurrent = alwaysCurrent) {
  try { await fetchCookieDocument(refreshStatus, isCurrent) }
  catch { /* The notice presents a safe, recoverable error. */ }
}

async function openLegal(target = route.params.documentRef, isCurrent = alwaysCurrent) {
  if (typeof target !== 'string') return
  globalThis.clearTimeout(legalBoundaryTimer)
  legalBoundaryTimer = null
  const epoch = ++documentEpoch
  const ownsDocument = () => epoch === documentEpoch && isCurrent()
  document.value = null
  await perform(async ownsOperation => {
    let envelope = null
    let result
    if (isDocumentId(target)) result = await store.read(target)
    else {
      await store.ensureOps()
      if (!ownsOperation()) return
      const kind = store.kindByAlias(target)
      envelope = kind !== undefined ? await store.current(kind) : null
      result = envelope ? envelope.document : await store.read(target)
    }
    if (!ownsOperation()) return
    const delay = nextChangeDelay(envelope)
    if (delay !== null) {
      scheduleBoundary(delay, value => { legalBoundaryTimer = value }, () => {
        if (epoch === documentEpoch && isCurrent()) openLegal(target, isCurrent)
      })
    }
    document.value = requireDocument(result, 'Документ пока не действует.')
  }, undefined, ownsDocument)
}

function printLegal() { legalReader.value?.printDocument() }

async function openCookies(isCurrent = alwaysCurrent, preserveChoice = false) {
  isCurrent = currentPredicate(isCurrent)
  if (!isCurrent()) return
  if (props.mode === 'notice') {
    await router.push({ name: 'consents' })
    return
  }
  const previousDocumentSignature = documentSignature(cookieDocument.value)
  if (!preserveChoice) {
    categories.value = []
    resetChoice()
  }
  await perform(async ownsOperation => {
    if (opsProblem.value) await store.loadOps()
    if (!ownsOperation()) return
    const result = await fetchCookieDocument(true, ownsOperation)
    if (ownsOperation() && preserveChoice
      && documentSignature(result) !== previousDocumentSignature) {
      categories.value = []
      resetChoice()
    }
  }, undefined, isCurrent)
}

async function chooseCookies(decision) {
  await perform(async ownsOperation => {
    let text = cookieDocument.value
    if (decision === 'withdraw' && cookies.value?.documentId) text = await store.read(cookies.value.documentId)
    if (!ownsOperation()) return
    if (!text) return
    const selected = decision === 'grant' ? categories.value : []
    const signature = JSON.stringify([text.id, text.contentHash, decision, [...selected].sort()])
    if (choiceSignature !== signature) resetChoice()
    choiceSignature = signature
    await store.decideCookies(text, decision, selected, choiceKey)
    if (!ownsOperation()) return
    resetChoice()
    categories.value = []
  }, async ownsOperation => {
    if (!ownsOperation()) return
    categories.value = []
    cookieDocument.value = null
    resetChoice()
    await fetchCookieDocument(true, ownsOperation)
  })
}

async function showPersonal(isCurrent = alwaysCurrent, preserveChoice = false) {
  if (!isCurrent()) return
  const previousDocumentSignature = documentSignature(personalDocument.value)
  if (!preserveChoice) {
    accepted.value = false
    personalDocument.value = null
  }
  await perform(async ownsOperation => {
    if (opsProblem.value) await store.loadOps()
    if (!ownsOperation()) return
    await store.loadMine()
    if (!ownsOperation()) return
    const result = requireDocument(
      (await store.current(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)).document,
      'Документ о согласии на обработку персональных данных пока не действует.'
    )
    if (!ownsOperation()) return
    if (preserveChoice && documentSignature(result) !== previousDocumentSignature) {
      accepted.value = false
      resetPersonalChoice()
    }
    personalDocument.value = result
  }, undefined, isCurrent)
}

async function refreshPersonalDocument(isCurrent = alwaysCurrent) {
  if (!isCurrent()) return
  accepted.value = false
  personalDocument.value = null
  await perform(async ownsOperation => {
    const result = requireDocument(
      (await store.current(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)).document,
      'Документ о согласии на обработку персональных данных пока не действует.'
    )
    if (ownsOperation()) personalDocument.value = result
  }, undefined, isCurrent)
}

async function openPersonal(isCurrent = alwaysCurrent, preserveChoice = false) {
  isCurrent = currentPredicate(isCurrent)
  await showPersonal(isCurrent, preserveChoice)
}

async function grant() {
  if (!accepted.value || !personalDocument.value || !session.customer.value) return
  await perform(async ownsOperation => {
    const signature = JSON.stringify([session.customer.value.id, personalDocument.value.id, personalDocument.value.contentHash])
    if (personalSignature !== signature) personalKey = globalThis.crypto.randomUUID()
    personalSignature = signature
    await store.grant(personalDocument.value, personalKey)
    if (!ownsOperation()) return
    personalSignature = ''
    accepted.value = false
  }, async ownsOperation => {
    if (!ownsOperation()) return
    accepted.value = false
    personalDocument.value = null
    await store.loadMine()
    if (!ownsOperation()) return
    const result = requireDocument(
      (await store.current(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)).document,
      'Документ о согласии на обработку персональных данных пока не действует.'
    )
    if (!ownsOperation()) return
    personalDocument.value = result
  })
}

async function requestWithdrawal() {
  await perform(() => store.requestWithdrawal(), undefined, alwaysCurrent, () => store.loadMine())
}

async function refreshNotice(isCurrent = alwaysCurrent) {
  await perform(async ownsOperation => {
    if (session.customer.value) await store.loadMine()
    if (!ownsOperation()) return
    await store.loadOps()
    if (!ownsOperation()) return
    await loadCookieStatus()
    if (ownsOperation() && cookieRequired.value) await fetchCookieDocument(false, ownsOperation)
  }, undefined, isCurrent)
}

async function refreshCookieDocumentBoundary(isCurrent = alwaysCurrent) {
  if (!isCurrent()) return
  categories.value = []
  cookieDocument.value = null
  resetChoice()
  if (props.mode === 'notice') {
    await prepareCookieNotice(true, isCurrent)
    return
  }
  await openCookies(isCurrent)
}

async function refreshVisible() {
  const epoch = ++viewEpoch
  const currentSession = sessionEpoch
  const isCurrent = () => mounted && epoch === viewEpoch && currentSession === sessionEpoch
  if (props.mode === 'legal') {
    await openLegal(undefined, isCurrent)
    return
  }
  if (props.mode === 'consents') {
    if (cookiePage.value) {
      await openCookies(isCurrent, true)
      if (!isCurrent()) return
    }
    if (personalPage.value) await openPersonal(isCurrent, true)
    return
  }
  await perform(async ownsOperation => {
    await Promise.all([loadCookieStatus(), store.loadMine()])
    if (ownsOperation() && cookieRequired.value) await fetchCookieDocument(false, ownsOperation)
  }, undefined, isCurrent)
}

async function drainQueuedRefreshes() {
  if (refreshQueueRunning || !mounted || busy.value || cookieDocumentBusy.value || cookieStatusLoads.value > 0) return
  refreshQueueRunning = true
  try {
    while (mounted && !busy.value && !cookieDocumentBusy.value && cookieStatusLoads.value === 0) {
      if (cookieRefreshPending) {
        cookieRefreshPending = false
        await refreshRequiredCookies()
      } else if (personalRefreshPending) {
        const isCurrent = personalRefreshPending
        personalRefreshPending = null
        await refreshPersonalDocument(isCurrent)
      } else if (cookieBoundaryRefreshPending) {
        const isCurrent = cookieBoundaryRefreshPending
        cookieBoundaryRefreshPending = null
        await refreshCookieDocumentBoundary(isCurrent)
      } else if (foregroundRefreshPending) {
        foregroundRefreshPending = false
        await refreshVisible()
      } else break
    }
  } finally {
    refreshQueueRunning = false
  }
}

async function visible() {
  if (!mounted || globalThis.document.visibilityState !== 'visible') return
  foregroundRefreshPending = true
  await drainQueuedRefreshes()
}

watch(() => session.customer.value?.id, async (id, _previous, cleanup) => {
  if (props.mode === 'legal') {
    store.resetCustomer()
    return
  }
  const epoch = ++sessionEpoch
  const isCurrent = () => epoch === sessionEpoch
  cleanup(() => {
    if (epoch === sessionEpoch) sessionEpoch++
    cookieDocumentEpoch++
    cookieDocumentBusy.value = false
    invalidateOperations()
  })
  invalidateOperations()
  store.resetCustomer()
  resetPersonalChoice()
  personalBoundary = null
  personalRefreshPending = null
  problem.value = null
  personalDocument.value = null
  if (!id) {
    if (props.mode === 'notice') await refreshNotice(isCurrent)
    else await openCookies(isCurrent)
    return
  }
  try {
    if (props.mode !== 'legal' && store.serviceAllowed.value) await store.associate()
    if (!isCurrent()) return
    if (props.mode === 'notice') await refreshNotice(isCurrent)
    if (cookiePage.value) {
      await openCookies(isCurrent)
      if (!isCurrent()) return
    }
    if (personalPage.value) await showPersonal(isCurrent)
  } catch (error) {
    if (isCurrent()) problem.value = normalizeProblem(error)
  }
}, { immediate:true })

async function refreshRequiredCookies() {
  cookieRefreshPending = false
  categories.value = []
  cookieDocument.value = null
  resetChoice()
  if (props.mode === 'notice') {
    await prepareCookieNotice()
    return
  }
  if (props.mode !== 'consents' || !cookiePage.value) return
  const epoch = sessionEpoch
  await openCookies(() => mounted && epoch === sessionEpoch && cookiePage.value)
}

watch(cookieRequired, async required => {
  if (!required) {
    cookieRefreshPending = false
    cookieDocumentProblem.value = null
    if (props.mode === 'notice') {
      cookieDocumentEpoch++
      cookieDocumentBusy.value = false
    }
    return
  }
  cookieRefreshPending = true
  await drainQueuedRefreshes()
})

watch([busy, cookieDocumentBusy, cookieStatusLoads], async () => {
  await drainQueuedRefreshes()
})

watch(mine, async value => {
  if (!value) return
  const previousBoundary = personalBoundary
  personalBoundary = value.nextChangeAt || null
  const serverNow = Date.parse(value.serverNow)
  const boundary = Date.parse(previousBoundary)
  if (!previousBoundary || !personalPage.value
    || !Number.isFinite(serverNow) || !Number.isFinite(boundary) || serverNow < boundary) return
  const epoch = sessionEpoch
  const isCurrent = () => mounted && epoch === sessionEpoch && personalPage.value
  personalRefreshPending = isCurrent
  await drainQueuedRefreshes()
})

watch(serviceUnavailable, unavailable => {
  if (props.mode === 'notice') emit('service-unavailable', unavailable)
}, { immediate:true })

watch(() => route.params.documentRef, async (target, _previous, cleanup) => {
  if (props.mode !== 'legal') return
  let active = true
  cleanup(() => {
    active = false
    documentEpoch++
  })
  await openLegal(target, () => active)
})

onMounted(() => {
  mounted = true
  globalThis.addEventListener('focus', visible)
  globalThis.document.addEventListener('visibilitychange', visible)
  if (props.mode === 'legal') openLegal(undefined, () => mounted)
})

onUnmounted(() => {
  mounted = false
  globalThis.clearTimeout(legalBoundaryTimer)
  legalBoundaryTimer = null
  globalThis.clearTimeout(cookieBoundaryTimer)
  cookieBoundaryTimer = null
  cookieBoundaryRefreshPending = null
  personalRefreshPending = null
  foregroundRefreshPending = false
  viewEpoch++
  documentEpoch++
  cookieDocumentEpoch++
  sessionEpoch++
  invalidateOperations()
  globalThis.removeEventListener('focus', visible)
  globalThis.document.removeEventListener('visibilitychange', visible)
})
</script>

<template>
  <ServiceUnavailablePage
    v-if="serviceUnavailable"
    :busy="busy"
    @retry="retry"
  />

  <section
    v-else-if="mode === 'notice' && cookieRequired"
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
        Согласия
      </UiButton>
      <UiButton
        v-if="cookieNoticeError"
        variant="quiet"
        :disabled="busy || cookieDocumentBusy"
        @click="retry"
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
      <RouterLink
        v-if="session.customer.value"
        :to="{ name: 'consents' }"
      >
        Согласия
      </RouterLink>
    </nav>
  </section>

  <section
    v-else-if="mode === 'notice' && activeProblem"
    class="cookie-notice consent-recovery-notice"
    role="region"
    aria-labelledby="consent-recovery-title"
  >
    <h2 id="consent-recovery-title">
      Не удалось обновить согласия
    </h2>
    <UiAlert
      :title="activeProblem.title"
      class="consent-page__alert"
    >
      {{ message }}
    </UiAlert>
    <div class="cookie-notice__actions">
      <UiButton
        variant="primary"
        :disabled="busy"
        @click="retry"
      >
        Повторить
      </UiButton>
    </div>
  </section>

  <main
    v-else-if="mode === 'consents'"
    class="page-container consent-page"
  >
    <header class="page-heading consent-page__heading">
      <div>
        <p class="page-kicker">
          КОНФИДЕНЦИАЛЬНОСТЬ
        </p>
        <h1>{{ consentPageTitle }}</h1>
        <p>{{ consentPageCopy }}</p>
      </div>
      <UiButton
        variant="secondary"
        @click="router.push({ name: 'home' })"
      >
        На главную
      </UiButton>
    </header>
    <UiAlert
      v-if="message"
      :title="activeProblem.title"
      class="consent-page__alert"
    >
      {{ message }}
    </UiAlert>
    <div
      v-if="cookiePage"
      class="consent-page__panel consent-page__panel--cookies"
    >
      <h2
        v-if="combinedPage"
        class="consent-page__panel-title"
      >
        Согласие на использование куки
      </h2>
      <section class="consent-section consent-section--soft">
        <component :is="combinedPage ? 'h3' : 'h2'">
          Состояние в этом браузере
        </component>
        <dl class="consent-summary">
          <dt>Статус</dt>
          <dd><span class="consent-status">{{ label(cookies?.status || 'unavailable') }}</span></dd>
          <dt>Выбранные категории</dt>
          <dd>{{ cookies?.categories?.length ? cookies.categories.map(store.cookieCategoryName).join(', ') : 'Нет' }}</dd>
        </dl>
      </section>
      <section
        v-if="cookieDocument"
        class="consent-section"
      >
        <component :is="combinedPage ? 'h3' : 'h2'">
          Актуальный документ
        </component>
        <LegalDocumentReader :document="cookieDocument" />
      </section>
      <section
        v-if="cookieNeedsGrant && cookieDocument"
        class="consent-section"
      >
        <component :is="combinedPage ? 'h3' : 'h2'">
          Новое подтверждение
        </component>
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
      <div class="consent-page__actions">
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
      </div>
    </div>
    <div
      v-if="personalPage"
      class="consent-page__panel consent-page__panel--personal"
    >
      <h2
        v-if="combinedPage"
        class="consent-page__panel-title"
      >
        Согласие на обработку персональных данных
      </h2>
      <section class="consent-section consent-section--soft">
        <component :is="combinedPage ? 'h3' : 'h2'">
          Состояние согласия
        </component>
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
        <component :is="combinedPage ? 'h3' : 'h2'">
          Актуальный документ
        </component>
        <LegalDocumentReader :document="personalDocument" />
      </section>
      <section
        v-if="status?.status !== 'current' && personalDocument"
        class="consent-section"
      >
        <component :is="combinedPage ? 'h3' : 'h2'">
          Подтверждение согласия
        </component>
        <UiSelectionControl
          :model-value="accepted"
          :disabled="busy"
          @update:model-value="accepted = $event"
        >
          Я даю отдельное согласие на хранение и обработку персональных данных по этому документу
        </UiSelectionControl>
      </section>
      <section class="consent-section">
        <component :is="combinedPage ? 'h3' : 'h2'">
          Прекращение использования системы
        </component>
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
        <component :is="combinedPage ? 'h3' : 'h2'">
          История
        </component>
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
      <div class="consent-page__actions">
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
      </div>
    </div>
  </main>

  <main
    v-else-if="mode === 'legal'"
    class="page-container consent-page legal-document-page"
  >
    <header class="page-heading consent-page__heading">
      <div>
        <p class="page-kicker">
          ЮРИДИЧЕСКИЕ ДОКУМЕНТЫ
        </p>
        <component
          :is="legalDocumentHasH1 ? 'div' : 'h1'"
          class="consent-page__document-title"
        >
          {{ document?.title || 'Юридический документ' }}
        </component>
      </div>
      <UiButton
        variant="secondary"
        @click="router.push({ name: 'home' })"
      >
        На главную
      </UiButton>
    </header>
    <UiAlert
      v-if="message"
      :title="activeProblem.title"
      class="consent-page__alert"
    >
      {{ message }}
    </UiAlert>
    <div
      v-if="message"
      class="consent-page__actions"
    >
      <UiButton
        variant="primary"
        :loading="busy"
        @click="retry"
      >
        Повторить
      </UiButton>
    </div>
    <div
      v-if="document"
      class="consent-page__panel legal-document-page__panel"
    >
      <LegalDocumentReader
        ref="legalReader"
        :document="document"
      />
      <div class="consent-page__actions">
        <UiButton
          variant="secondary"
          @click="printLegal"
        >
          Печать
        </UiButton>
      </div>
    </div>
    <div
      v-else-if="!message"
      class="consent-page__loading"
      aria-label="Загрузка документа"
    >
      <span
        class="route-gate__spinner"
        aria-hidden="true"
      />
      <p>Загружаем документ</p>
    </div>
  </main>
</template>
