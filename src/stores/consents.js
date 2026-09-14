// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { readonly, ref } from 'vue'
import { useSession } from './session.js'
import { isIsoDate, isRfc3339DateTime } from '../api/validation.js'
import { createInternalProblem } from '../errors/problem.js'
import { LEGAL_DOCUMENT_KIND, isDocumentId } from '../consentFormatting.js'

const json = (method, body) => ({ method, headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) })
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const validText = (value, maximum) => typeof value === 'string' && value.trim() && value.length <= maximum
export function createConsentStore(session) {
  const mine = ref(null)
  const ops = ref(null)
  const opsProblem = ref(null)
  const personalProblem = ref(null)
  let personalTimer = null
  let generation = 0
  let mineGeneration = 0
  let opsRequest = null
  function resetCustomer() { generation++; globalThis.clearTimeout(personalTimer); mine.value = null; personalProblem.value = null }
  function validateOps(value) {
    if (!value || !Array.isArray(value.kinds) || value.kinds.length === 0) throw createInternalProblem('protocolError')
    const values = new Set()
    const aliases = new Set()
    for (const item of value.kinds) {
      if (!item || !Number.isInteger(item.value) || item.value <= 0 || typeof item.name !== 'string' || !item.name.trim()
        || typeof item.routeAlias !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(item.routeAlias)
        || values.has(item.value) || aliases.has(item.routeAlias)) throw createInternalProblem('protocolError')
      values.add(item.value)
      aliases.add(item.routeAlias)
    }
    return {
      kinds:value.kinds.map(item => ({ value:item.value, name:item.name, routeAlias:item.routeAlias }))
    }
  }
  async function loadOps() {
    if (opsRequest) return opsRequest
    opsProblem.value = null
    opsRequest = session.consentRequest('/api/v1/legal/ops')
      .then(value => { ops.value = validateOps(value); return ops.value })
      .catch(problem => { opsProblem.value = problem; throw problem })
      .finally(() => { opsRequest = null })
    return opsRequest
  }
  async function ensureOps() { return ops.value || loadOps() }
  function kindByAlias(alias) { return ops.value?.kinds.find(item => item.routeAlias === alias)?.value }
  function kindName(kind) { return ops.value?.kinds.find(item => item.value === kind)?.name }
  function routeAlias(kind) { return ops.value?.kinds.find(item => item.value === kind)?.routeAlias }
  function validateDocument(value, kind) {
    if (!value || !isDocumentId(value.id) || value.kind !== kind
      || !Number.isInteger(kind) || !kindName(kind)
      || value.locale !== 'ru' || !validText(value.title, 200) || !validText(value.displayVersion, 64)
      || typeof value.html !== 'string' || typeof value.sourceHash !== 'string' || !SHA256_PATTERN.test(value.sourceHash)
      || typeof value.contentHash !== 'string' || !SHA256_PATTERN.test(value.contentHash)
      || !validText(value.rendererVersion, 64) || !isRfc3339DateTime(value.effectiveAt) || !isRfc3339DateTime(value.createdAt)
      || !isIsoDate(value.effectiveLocalDate) || value.effectiveTimeZone !== 'Europe/Moscow'
      || value.createdBy !== null || value.canDelete !== null) {
      throw createInternalProblem('protocolError')
    }
  }
  function validWithdrawalRequest(value, identity) {
    return value === null || (value && value.customerId === identity
      && Number.isFinite(Date.parse(value.requestedAt)) && typeof value.processed === 'boolean')
  }
  async function current(kind) {
    await ensureOps()
    if (!Number.isInteger(kind) || !ops.value.kinds.some(item => item.value === kind)) throw createInternalProblem('invalidInput')
    const result = await session.consentRequest(`/api/v1/legal/current/${kind}`)
    if (!result || !isRfc3339DateTime(result.serverNow)
      || result.nextChangeAt !== null && (!isRfc3339DateTime(result.nextChangeAt)
        || Date.parse(result.nextChangeAt) <= Date.parse(result.serverNow))) throw createInternalProblem('protocolError')
    if (result.document !== null) validateDocument(result.document, kind)
    if (result.document && Date.parse(result.document.effectiveAt) > Date.parse(result.serverNow)) {
      throw createInternalProblem('protocolError')
    }
    return result
  }
  async function read(id) {
    if (!isDocumentId(id)) throw createInternalProblem('invalidInput')
    await ensureOps()
    const value = await session.consentRequest(`/api/v1/legal/documents/${id}`)
    validateDocument(value, value?.kind)
    if (value.id.toLowerCase() !== id.toLowerCase()) throw createInternalProblem('protocolError')
    return value
  }
  async function source(id) {
    if (!isDocumentId(id)) throw createInternalProblem('invalidInput')
    return session.consentRequest(`/api/v1/legal/documents/${id}/source`, { headers:{ Accept:'text/markdown, application/problem+json' } }, false, 'blob')
  }
  async function loadMine() {
    const epoch = generation
    const requestId = ++mineGeneration
    const identity = session.customer.value?.id
    mine.value = null
    globalThis.clearTimeout(personalTimer)
    personalProblem.value = null
    if (!identity) return
    try {
      await ensureOps()
      const value = await session.consentRequest('/api/v1/consents/me', {}, true)
      if (!value || value.customerId !== identity || !Array.isArray(value.statuses) || !Array.isArray(value.history)
        || !validWithdrawalRequest(value.withdrawalRequest, identity)
        || [...value.statuses, ...value.history].some(item => !Number.isInteger(item.kind) || !kindName(item.kind))) throw createInternalProblem('protocolError')
      const delay = value.nextChangeAt ? Date.parse(value.nextChangeAt) - Date.parse(value.serverNow) : null
      if (delay !== null && (!Number.isFinite(delay) || delay <= 0)) throw createInternalProblem('protocolError')
      if (epoch === generation && requestId === mineGeneration && session.customer.value?.id === identity) {
        mine.value = value
        function schedule(remaining) {
          const chunk = Math.min(remaining, 2147483647)
          personalTimer = globalThis.setTimeout(() => {
            if (remaining > chunk) schedule(remaining - chunk)
            else loadMine().catch(problem => { if (epoch === generation) personalProblem.value = problem })
          }, chunk)
        }
        if (delay !== null) schedule(delay)
      }
    } catch (problem) { if (epoch === generation && requestId === mineGeneration) personalProblem.value = problem; throw problem }
  }
  async function requirePersonalData() {
    await loadMine()
    if (mine.value?.statuses.find(x => x.kind === LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)?.status !== 'current') {
      throw createInternalProblem('invalidInput', { detail:'Откройте «Согласия» и дайте актуальное согласие. Введённые данные сохранены в форме.' })
    }
  }
  async function hasCurrentPersonalData() {
    await loadMine()
    return mine.value?.statuses.find(x => x.kind === LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)?.status === 'current'
  }
  async function grant(document, key = globalThis.crypto.randomUUID()) {
    await session.consentRequest('/api/v1/consents/me/personal-data', json('POST', {
      documentId:document.id, contentHash:document.contentHash, decision:'grant', idempotencyKey:key
    }), true)
    await loadMine()
  }
  async function requestWithdrawal() {
    await session.consentRequest('/api/v1/consents/me/withdrawal-request', { method:'POST' }, true)
    await loadMine()
  }
  function dispose() { resetCustomer() }
  return { mine:readonly(mine), ops:readonly(ops), opsProblem:readonly(opsProblem),
    personalProblem:readonly(personalProblem), current, read, source, loadOps, ensureOps,
    kindByAlias, kindName, routeAlias, loadMine, requirePersonalData, hasCurrentPersonalData,
    grant, requestWithdrawal, resetCustomer, dispose }
}
let store
export function useConsents() { return store ??= createConsentStore(useSession()) }
export function resetConsentsForTests() {
  store?.dispose()
  store = undefined
}
