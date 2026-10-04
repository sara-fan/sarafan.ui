<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import { LEGAL_DOCUMENT_KIND, CONSENT_STATUSES, documentNodes, isDocumentId, moscowTime } from '../consentFormatting.js'
import {
  createInternalProblem, asServiceUnavailableProblem, isServiceUnavailableProblem,
  normalizeProblem, presentProblem, presentProblemTitle
} from '../errors/problem.js'
import { useConsents } from '../stores/consents.js'
import { nextChangeDelay, scheduleBoundary } from '../consentTiming.js'
import { useSession } from '../stores/session.js'
import { useConsentRenewal } from '../useConsentRenewal.js'
import ConsentRenewalDialog from './ConsentRenewalDialog.vue'
import LegalDocumentReader from './LegalDocumentReader.vue'
import ServiceUnavailablePage from './ServiceUnavailablePage.vue'
import UiAlert from './ui/UiAlert.vue'
import UiButton from './ui/UiButton.vue'

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
  noticeSuppressed: { type: Boolean, default: false }
})
const emit = defineEmits(['personal-consent-granted'])
const session = useSession()
const store = useConsents()
const route = useRoute()
const renewal = useConsentRenewal()
const { mine, ops, opsProblem, personalProblem } = store
const document = ref(null)
const legalReader = ref(null)
const problem = ref(null)
const busy = ref(false)
let documentEpoch = 0
let lastAttempt = null
let operationEpoch = 0
let sessionEpoch = 0
let viewEpoch = 0
let mounted = false
let legalBoundaryTimer = null
let foregroundRefreshPending = false
let refreshQueueRunning = false
let releaseNotice = null

const alwaysCurrent = () => true
const authenticated = computed(() => Boolean(session.customer.value))
const consentRows = computed(() => (ops.value?.kinds || []).map(kind => ({
  ...kind,
  consent: mine.value?.statuses.find(item => item.kind === kind.value)
})))
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
  if (renewal.state.open) return null
  return prioritizedProblem([problem.value, personalProblem.value, opsProblem.value])
})
const presentationProblem = computed(() => activeProblem.value && isServiceUnavailableProblem(activeProblem.value)
  ? asServiceUnavailableProblem(activeProblem.value) : activeProblem.value)
const message = computed(() => presentationProblem.value ? presentProblem(presentationProblem.value) : '')
const errorTitle = computed(() => presentProblemTitle(presentationProblem.value))
const serviceUnavailable = computed(() => props.mode === 'legal'
  && isServiceUnavailableProblem(activeProblem.value))
const label = value => CONSENT_STATUSES[value] || value

function requireDocument(value) {
  if (!value) throw createInternalProblem('invalidInput', { detail:'Документ пока не действует.' })
  if (!Number.isFinite(Date.parse(value.effectiveAt))) throw createInternalProblem('protocolError')
  documentNodes(value.html)
  return value
}
function ownNotice() { releaseNotice ??= store.acquireNoticeSuppression() }
function releaseNoticeOwnership() { releaseNotice?.(); releaseNotice = null }
function releaseNoticeIfClear() {
  if (!activeProblem.value && !busy.value) releaseNoticeOwnership()
}
function invalidateOperations() {
  operationEpoch++
  lastAttempt = null
  foregroundRefreshPending = false
  busy.value = false
}

async function perform(action, isCurrent = alwaysCurrent, retryAction = action) {
  if (!isCurrent()) return false
  const operation = ++operationEpoch
  const ownsOperation = () => operation === operationEpoch && isCurrent()
  let succeeded = false
  lastAttempt = { action:retryAction, isCurrent }
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
  } finally {
    if (ownsOperation()) {
      busy.value = false
      releaseNoticeIfClear()
    }
  }
  return succeeded
}

async function retry() {
  const epoch = sessionEpoch
  const isCurrent = () => mounted && epoch === sessionEpoch
  const attempt = lastAttempt
  if (attempt) {
    if (props.mode === 'consents') ownNotice()
    await perform(attempt.action, () => isCurrent() && attempt.isCurrent())
    return
  }
  if (props.mode === 'notice') await refreshNotice(isCurrent)
  else if (props.mode === 'legal') await openLegal(undefined, isCurrent)
  else await refreshConsentPage(isCurrent)
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
    document.value = requireDocument(result)
  }, ownsDocument)
}

function printLegal() { legalReader.value?.printDocument() }

async function renew(kind) {
  if (busy.value || !authenticated.value) return
  ownNotice()
  let confirmed = false
  const succeeded = await perform(async isCurrent => {
    confirmed = await renewal.ensure([kind], isCurrent)
  }, alwaysCurrent, () => refreshConsentPage())
  if (succeeded && confirmed && kind === LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT) emit('personal-consent-granted')
}

async function requestWithdrawal() {
  if (busy.value || !mine.value || withdrawalPending.value) return
  ownNotice()
  await perform(() => store.requestWithdrawal(), alwaysCurrent, () => store.loadMine())
}

async function refreshNotice(isCurrent = alwaysCurrent) {
  await perform(() => store.loadOps(), isCurrent)
}

async function refreshConsentPage(isCurrent = alwaysCurrent) {
  if (!isCurrent()) return
  ownNotice()
  await perform(async ownsOperation => {
    if (opsProblem.value || !ops.value) await store.loadOps()
    if (ownsOperation() && authenticated.value) await store.loadMine()
  }, isCurrent)
}

async function refreshVisible() {
  const epoch = ++viewEpoch
  const currentSession = sessionEpoch
  const isCurrent = () => mounted && epoch === viewEpoch && currentSession === sessionEpoch
  if (props.mode === 'legal') await openLegal(undefined, isCurrent)
  else if (props.mode === 'consents') await refreshConsentPage(isCurrent)
  else await refreshNotice(isCurrent)
}

async function drainQueuedRefreshes() {
  if (refreshQueueRunning || !mounted || busy.value) return
  refreshQueueRunning = true
  try {
    while (mounted && !busy.value && foregroundRefreshPending) {
      foregroundRefreshPending = false
      await refreshVisible()
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

watch(() => session.customer.value?.id, async (_id, _previous, cleanup) => {
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
  renewal.cancel()
  problem.value = null
  if (props.mode === 'notice') await refreshNotice(isCurrent)
  else await refreshConsentPage(isCurrent)
}, { immediate:true, flush:'sync' })

watch(busy, drainQueuedRefreshes)
watch(activeProblem, releaseNoticeIfClear)

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
  foregroundRefreshPending = false
  viewEpoch++
  documentEpoch++
  sessionEpoch++
  invalidateOperations()
  releaseNoticeOwnership()
  if (props.mode === 'consents') store.resetCustomer()
  globalThis.removeEventListener('focus', visible)
  globalThis.document.removeEventListener('visibilitychange', visible)
})
</script>

<template>
  <ServiceUnavailablePage
    v-if="serviceUnavailable"
    :busy="busy"
    :message="message"
    @retry="retry"
  />

  <section
    v-else-if="mode === 'notice' && activeProblem && !noticeSuppressed"
    class="consent-recovery-notice"
    role="region"
    aria-live="polite"
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
    <header class="page-heading consent-page__heading">
      <h1>Согласия</h1>
    </header>
    <UiAlert
      v-if="message"
      :title="errorTitle"
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
    <p v-if="!authenticated">
      Войдите в аккаунт, чтобы просмотреть согласия и историю.
    </p>
    <div
      v-else-if="mine"
      class="consent-center"
    >
      <section
        class="consent-section consent-documents"
        aria-labelledby="consent-documents-title"
      >
        <h2 id="consent-documents-title">
          Документы
        </h2>
        <ul class="consent-documents__list">
          <li
            v-for="row in consentRows"
            :key="row.value"
            class="consent-documents__row"
          >
            <div>
              <h3>{{ row.name }}</h3>
              <p>{{ label(row.consent?.status ?? 'unavailable') }}</p>
            </div>
            <div class="consent-documents__actions">
              <RouterLink
                v-if="row.consent?.requiredVersion"
                class="consent-document-link"
                :to="{ name: 'legal-document', params: { documentRef: row.routeAlias } }"
              >
                Действующая версия
              </RouterLink>
              <UiButton
                v-if="row.consent?.requiredVersion && row.consent.status !== 'current'"
                variant="primary"
                :disabled="busy"
                @click="renew(row.value)"
              >
                {{ row.value === LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT ? 'Дать согласие' : 'Принять соглашение' }}
              </UiButton>
            </div>
          </li>
        </ul>
      </section>
      <section
        class="consent-section consent-history-section"
        aria-labelledby="consent-history-title"
      >
        <h2 id="consent-history-title">
          История
        </h2>
        <ul
          v-if="historyNewestFirst.length"
          class="consent-history"
        >
          <li
            v-for="event in historyNewestFirst"
            :key="event.id"
          >
            <div>
              <strong>{{ store.kindName(event.kind) }}</strong>
              <p>{{ label(event.decision) }} · {{ moscowTime(event.at) }}</p>
            </div>
            <RouterLink :to="{ name: 'legal-document', params: { documentRef: event.documentId } }">
              Версия {{ event.displayVersion }}
            </RouterLink>
          </li>
        </ul>
        <p v-else>
          Записей пока нет.
        </p>
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
          v-if="mine.withdrawalRequest"
          class="withdrawal-record"
          role="status"
        >
          Запрос от {{ moscowTime(mine.withdrawalRequest.requestedAt) }} ·
          {{ mine.withdrawalRequest.processed ? 'Обработан' : 'Ожидает ручной обработки' }}
        </p>
      </section>
    </div>
    <div
      v-else-if="!message"
      class="consent-page__loading"
      aria-label="Загрузка согласий"
    >
      <span
        class="route-gate__spinner"
        aria-hidden="true"
      />
      <p>Загружаем согласия</p>
    </div>
    <ConsentRenewalDialog :flow="renewal" />
  </main>

  <main
    v-else-if="mode === 'legal'"
    class="page-container consent-page legal-document-page"
  >
    <header class="page-heading consent-page__heading legal-document-page__heading">
      <component
        :is="legalDocumentHasH1 ? 'div' : 'h1'"
        class="consent-page__document-title"
      >
        {{ document?.title || 'Юридический документ' }}
      </component>
      <UiButton
        variant="secondary"
        :disabled="!document"
        @click="printLegal"
      >
        Печать
      </UiButton>
    </header>
    <UiAlert
      v-if="message"
      :title="errorTitle"
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
      id="document-content"
      class="consent-page__panel legal-document-page__panel"
    >
      <LegalDocumentReader
        ref="legalReader"
        :document="document"
      />
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
