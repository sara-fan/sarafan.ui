<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { LEGAL_DOCUMENT_KIND, CONSENT_STATUSES, documentNodes, isDocumentId, moscowTime } from '../consentFormatting.js'
import {
  createInternalProblem,
  asServiceUnavailableProblem,
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
    validator: value => ['auto', 'personal'].includes(value)
  },
  noticeSuppressed: {
    type: Boolean,
    default: false
  }
})
const session = useSession()
const store = useConsents()
const route = useRoute()
const router = useRouter()
const { mine, opsProblem, personalProblem } = store
const document = ref(null)
const legalReader = ref(null)
const personalDocument = ref(null)
const accepted = ref(false)
const problem = ref(null)
const busy = ref(false)
let documentEpoch = 0
let personalKey = globalThis.crypto.randomUUID()
let personalSignature = ''
let lastAttempt = null
let operationEpoch = 0
let sessionEpoch = 0
let viewEpoch = 0
let mounted = false
let legalBoundaryTimer = null
let personalBoundary = null
let personalRefreshPending = null
let foregroundRefreshPending = false
let refreshQueueRunning = false

const alwaysCurrent = () => true
const currentPredicate = value => typeof value === 'function' ? value : alwaysCurrent

const authenticated = computed(() => Boolean(session.customer.value))
const personalPage = computed(() => props.mode === 'consents' && authenticated.value)
const consentPageTitle = computed(() => store.kindName(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)
  || 'Загрузка юридического документа')
const status = computed(() => mine.value?.statuses.find(item => item.kind === LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT))
const historyNewestFirst = computed(() => [...(mine.value?.history || [])]
  .sort((left, right) => Date.parse(right.at) - Date.parse(left.at)))
const withdrawalPending = computed(() => mine.value?.withdrawalRequest?.processed === false)
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
  if (props.mode === 'notice') return prioritizedProblem([problem.value, opsProblem.value])
  return prioritizedProblem([problem.value, personalProblem.value, opsProblem.value])
})
const message = computed(() => activeProblem.value ? presentProblem(activeProblem.value) : '')
const serviceUnavailable = computed(() => props.mode !== 'notice'
  && isServiceUnavailableProblem(activeProblem.value))
const label = value => CONSENT_STATUSES[value] || value
const serviceUnavailableMessage = computed(() => activeProblem.value
  ? presentProblem(asServiceUnavailableProblem(activeProblem.value)) : '')
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
function resetPersonalChoice() { personalKey = globalThis.crypto.randomUUID(); personalSignature = '' }
function documentSignature(value) { return value ? `${value.id}:${value.contentHash}` : '' }
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
    await perform(attempt.action, attempt.onVersionChanged, () => isCurrent() && attempt.isCurrent())
    return
  }
  if (props.mode === 'notice') await refreshNotice(isCurrent)
  else if (props.mode === 'legal') await openLegal(undefined, isCurrent)
  else if (props.mode === 'consents') await refreshConsentPage(isCurrent)
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
  await perform(() => store.loadOps(), undefined, isCurrent)
}

async function refreshConsentPage(isCurrent = alwaysCurrent, preserveChoice = false) {
  if (personalPage.value) {
    await openPersonal(isCurrent, preserveChoice)
    return
  }
  await perform(() => store.loadOps(), undefined, isCurrent)
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
    await refreshConsentPage(isCurrent, true)
    return
  }
  await refreshNotice(isCurrent)
}

async function drainQueuedRefreshes() {
  if (refreshQueueRunning || !mounted || busy.value) return
  refreshQueueRunning = true
  try {
    while (mounted && !busy.value) {
      if (personalRefreshPending) {
        const isCurrent = personalRefreshPending
        personalRefreshPending = null
        await refreshPersonalDocument(isCurrent)
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
    else if (props.mode === 'consents') await refreshConsentPage(isCurrent)
    return
  }
  try {
    if (!isCurrent()) return
    if (props.mode === 'notice') await refreshNotice(isCurrent)
    if (props.mode === 'consents') await refreshConsentPage(isCurrent)
  } catch (error) {
    if (isCurrent()) problem.value = normalizeProblem(error)
  }
}, { immediate:true })

watch(busy, async () => {
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
  personalRefreshPending = null
  foregroundRefreshPending = false
  viewEpoch++
  documentEpoch++
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
    :message="serviceUnavailableMessage"
    @retry="retry"
  />

  <section
    v-else-if="mode === 'notice' && activeProblem && !noticeSuppressed"
    class="consent-recovery-notice"
    role="region"
    aria-labelledby="consent-recovery-title"
  >
    <h2
      id="consent-recovery-title"
      class="consent-recovery-notice__message"
    >
      {{ message }}
    </h2>
    <div class="consent-recovery-notice__actions">
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
    <header class="page-heading consent-page__heading consent-page__heading--personal">
      <h1>{{ consentPageTitle }}</h1>
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
    <p v-if="!authenticated">
      Войдите в аккаунт, чтобы просмотреть согласие и историю.
    </p>
    <div
      v-if="personalPage"
      class="consent-page__panel consent-page__panel--personal"
    >
      <section
        v-if="personalDocument"
        class="consent-section consent-section--document"
      >
        <h2>
          Действующий документ
        </h2>
        <LegalDocumentReader :document="personalDocument" />
        <div
          v-if="status?.status !== 'current'"
          class="consent-renewal"
        >
          <UiSelectionControl
            :model-value="accepted"
            :disabled="busy"
            @update:model-value="accepted = $event"
          >
            Я даю отдельное согласие на хранение и обработку персональных данных по этому документу
          </UiSelectionControl>
          <UiButton
            variant="primary"
            :disabled="busy || !accepted"
            @click="grant"
          >
            Дать согласие
          </UiButton>
        </div>
      </section>
      <section class="consent-section consent-section--withdrawal">
        <UiButton
          variant="danger"
          block
          :disabled="busy || withdrawalPending"
          @click="requestWithdrawal"
        >
          Прекратить использовать систему и отозвать согласие на хранение и обработку персональных данных
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
      <details class="consent-history-section">
        <summary>История</summary>
        <ul
          v-if="historyNewestFirst.length"
          class="consent-history"
        >
          <li
            v-for="event in historyNewestFirst"
            :key="event.id"
          >
            {{ store.kindName(event.kind) }} · {{ label(event.decision) }} · {{ moscowTime(event.at) }}
            <RouterLink :to="{ name: 'legal-document', params: { documentRef: event.documentId } }">
              Версия {{ event.displayVersion }}
            </RouterLink>
          </li>
        </ul>
        <p v-else>
          Записей пока нет.
        </p>
      </details>
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
