// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { onBeforeUnmount, reactive, watch } from 'vue'
import { CORE_PROBLEM_TYPES, createInternalProblem, normalizeProblem } from './errors/problem.js'
import { documentNodes } from './consentFormatting.js'
import { useConsents } from './stores/consents.js'
import { useSession } from './stores/session.js'

export function isConsentRenewalProblem(problem) {
  return [CORE_PROBLEM_TYPES.personalDataConsentRequired, CORE_PROBLEM_TYPES.userAgreementRequired,
    CORE_PROBLEM_TYPES.consentVersionChanged].includes(normalizeProblem(problem).type)
}

export function useConsentRenewal() {
  const consents = useConsents()
  const session = useSession()
  const state = reactive({ open:false, busy:false, documents:[], reading:null, problem:null, problemKind:null })
  let generation = 0
  let pending = null
  let required = []
  let current = () => false
  let releaseNotice = null
  let boundaryTimer = null
  let boundaryDue = false
  function release() { releaseNotice?.(); releaseNotice = null }
  function clearBoundary() {
    globalThis.clearTimeout(boundaryTimer)
    boundaryTimer = null
    boundaryDue = false
  }
  function cancel() {
    generation++
    clearBoundary()
    pending?.(false)
    pending = null
    state.open = false
    state.busy = false
    state.documents = []
    state.reading = null
    state.problem = null
    state.problemKind = null
    release()
  }
  function complete() {
    clearBoundary()
    const resolve = pending
    pending = null
    state.open = false
    state.reading = null
    state.problem = null
    state.problemKind = null
    release()
    resolve?.(true)
  }
  function scheduleBoundary(operation, deadline) {
    const remaining = Math.max(0, deadline - globalThis.performance.now())
    boundaryTimer = globalThis.setTimeout(() => {
      boundaryTimer = null
      if (operation !== generation || !current()) return
      if (deadline > globalThis.performance.now()) scheduleBoundary(operation, deadline)
      else if (state.busy) boundaryDue = true
      else void retry()
    }, Math.min(remaining, 2147483647))
  }
  async function refresh(operation) {
    if (operation !== generation || !current()) return false
    clearBoundary()
    const missing = await consents.missingKinds(required)
    if (operation !== generation || !current()) return false
    const documents = []
    let deadline = Infinity
    function includeBoundary(envelope) {
      if (envelope?.nextChangeAt) {
        deadline = Math.min(deadline, globalThis.performance.now()
          + Date.parse(envelope.nextChangeAt) - Date.parse(envelope.serverNow))
      }
    }
    includeBoundary(consents.mine?.value)
    for (const kind of missing) {
      const envelope = await consents.current(kind)
      if (operation !== generation || !current()) return false
      includeBoundary(envelope)
      const { document } = envelope
      if (!document) throw createInternalProblem('invalidInput', { detail:'Действующий документ недоступен. Повторите позже.' })
      documentNodes(document.html)
      const previous = state.documents.find(row => row.document.id === document.id && row.document.contentHash === document.contentHash)
      documents.push(previous || { document, accepted:false, key:globalThis.crypto.randomUUID() })
    }
    state.documents = documents
    state.reading = null
    if (documents.length && Number.isFinite(deadline)) scheduleBoundary(operation, deadline)
    return true
  }
  async function ensure(kinds, isCurrent) {
    cancel()
    required = kinds
    const operation = generation
    const identity = session.customer.value?.id
    current = () => Boolean(identity) && session.customer.value?.id === identity && isCurrent()
    releaseNotice = consents.acquireNoticeSuppression()
    try {
      if (!await refresh(operation)) { if (operation === generation) release(); return false }
      if (!state.documents.length) { release(); return true }
    } catch (problem) { if (operation === generation) release(); throw problem }
    state.open = true
    return new Promise(resolve => { pending = resolve })
  }
  async function confirm() {
    if (state.busy || !state.open || !state.documents.length || state.documents.some(row => !row.accepted)) return
    const operation = generation
    state.busy = true
    state.problem = null
    state.problemKind = null
    let grantKind = null
    try {
      for (const row of state.documents) {
        if (!current() || operation !== generation) return
        if (boundaryDue) break
        grantKind = row.document.kind
        await consents.grant(row.document, row.key)
      }
      grantKind = null
      if (await refresh(operation) && !state.documents.length) complete()
    } catch (problem) {
      if (operation !== generation || !current()) return
      state.problem = normalizeProblem(problem)
      state.problemKind = grantKind
      if (state.problem.type === CORE_PROBLEM_TYPES.consentVersionChanged) {
        try { if (await refresh(operation) && !state.documents.length) complete() }
        catch (failure) {
          if (operation === generation && current()) { state.problem = normalizeProblem(failure); state.problemKind = null }
        }
      }
    } finally {
      if (operation === generation) {
        state.busy = false
        if (boundaryDue && state.open) void retry()
      }
    }
  }
  async function retry() {
    if (state.busy) return
    const operation = generation
    state.busy = true
    state.problem = null
    state.problemKind = null
    try {
      if (await refresh(operation) && !state.documents.length) complete()
    } catch (problem) { if (operation === generation && current()) state.problem = normalizeProblem(problem) }
    finally { if (operation === generation) state.busy = false }
  }
  watch(() => session.customer.value?.id, cancel, { flush:'sync' })
  onBeforeUnmount(cancel)
  return { state, ensure, confirm, retry, cancel }
}
