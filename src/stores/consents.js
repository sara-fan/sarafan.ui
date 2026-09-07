// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, readonly, ref } from 'vue'
import { useSession } from './session.js'
import { createInternalProblem } from '../errors/problem.js'
import { LEGAL_DOCUMENT_KIND, isDocumentId } from '../consentFormatting.js'

const json = (method, body) => ({ method, headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) })
export function createConsentStore(session) {
  const cookies = ref(null)
  const mine = ref(null)
  const ops = ref(null)
  const opsProblem = ref(null)
  const cookieProblem = ref(null)
  const personalProblem = ref(null)
  let timer = null
  let personalTimer = null
  let generation = 0
  let cookieGeneration = 0
  let mineGeneration = 0
  let opsRequest = null
  const serviceAllowed = computed(() => cookies.value?.status === 'current'
    && (ops.value?.cookieCategories || []).filter(item => item.required).every(item => cookies.value.categories.includes(item.value)))
  function invalidateCookies() { cookies.value = null }
  function resetCustomer() { generation++; globalThis.clearTimeout(personalTimer); mine.value = null; personalProblem.value = null }
  function validateOps(value) {
    if (!value || !Array.isArray(value.kinds) || value.kinds.length === 0
      || !Array.isArray(value.cookieCategories) || value.cookieCategories.length === 0) throw createInternalProblem('protocolError')
    const values = new Set()
    const aliases = new Set()
    for (const item of value.kinds) {
      if (!item || !Number.isInteger(item.value) || item.value < 0 || typeof item.name !== 'string' || !item.name.trim()
        || typeof item.routeAlias !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(item.routeAlias)
        || values.has(item.value) || aliases.has(item.routeAlias)) throw createInternalProblem('protocolError')
      values.add(item.value)
      aliases.add(item.routeAlias)
    }
    const categoryValues = new Set()
    for (const item of value.cookieCategories) {
      if (!item || !Number.isInteger(item.value) || item.value < 0 || typeof item.name !== 'string' || !item.name.trim()
        || typeof item.required !== 'boolean' || categoryValues.has(item.value)) throw createInternalProblem('protocolError')
      categoryValues.add(item.value)
    }
    if (!value.cookieCategories.some(item => item.required)) throw createInternalProblem('protocolError')
    return {
      kinds:value.kinds.map(item => ({ value:item.value, name:item.name, routeAlias:item.routeAlias })),
      cookieCategories:value.cookieCategories.map(item => ({ value:item.value, name:item.name, required:item.required }))
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
  function cookieCategoryName(category) { return ops.value?.cookieCategories.find(item => item.value === category)?.name }
  function requiredCookieCategories() { return (ops.value?.cookieCategories || []).filter(item => item.required).map(item => item.value) }
  function validWithdrawalRequest(value, identity) {
    return value === null || (value && value.customerId === identity
      && Number.isFinite(Date.parse(value.requestedAt)) && typeof value.processed === 'boolean')
  }
  async function current(kind) {
    await ensureOps()
    if (!Number.isInteger(kind) || !ops.value.kinds.some(item => item.value === kind)) throw createInternalProblem('invalidInput')
    const result = await session.consentRequest(`/api/v1/legal/current/${kind}`)
    if (!result || !Number.isFinite(Date.parse(result.serverNow)) || (result.document && (!isDocumentId(result.document.id) || result.document.kind !== kind))) throw createInternalProblem('protocolError')
    if (result.document && (!Array.isArray(result.document.cookieCategories)
      || result.document.cookieCategories.some(category => !Number.isInteger(category) || !cookieCategoryName(category))
      || (kind === LEGAL_DOCUMENT_KIND.COOKIE_CONSENT
        && requiredCookieCategories().some(category => !result.document.cookieCategories.includes(category)))
      || (kind !== LEGAL_DOCUMENT_KIND.COOKIE_CONSENT && result.document.cookieCategories.length))) throw createInternalProblem('protocolError')
    return result
  }
  async function read(id) {
    if (!isDocumentId(id)) throw createInternalProblem('invalidInput')
    return session.consentRequest(`/api/v1/legal/documents/${id}`)
  }
  async function source(id) {
    if (!isDocumentId(id)) throw createInternalProblem('invalidInput')
    return session.consentRequest(`/api/v1/legal/documents/${id}/source`, { headers:{ Accept:'text/markdown, application/problem+json' } }, false, 'blob')
  }
  function applyCookies(result) {
    if (!result || !Array.isArray(result.categories) || !Number.isFinite(Date.parse(result.serverNow))
      || !['current','missing','refused','withdrawn','renewal-required','unavailable'].includes(result.status)
      || (result.status === 'current' && (!isDocumentId(result.documentId) || !result.expiresAt))
      || result.categories.some(category => !Number.isInteger(category) || !cookieCategoryName(category))
      || (result.status === 'current' && requiredCookieCategories().some(category => !result.categories.includes(category)))) throw createInternalProblem('protocolError')
    const boundaries = [result.expiresAt, result.nextChangeAt].filter(Boolean).map(Date.parse)
    if (boundaries.some(value => !Number.isFinite(value))) throw createInternalProblem('protocolError')
    const delay = Math.min(...boundaries) - Date.parse(result.serverNow)
    cookies.value = result
    globalThis.clearTimeout(timer)
    function schedule(remaining) {
      if (remaining <= 0) { invalidateCookies(); return }
      const chunk = Math.min(remaining, 2147483647)
      timer = globalThis.setTimeout(() => schedule(remaining - chunk), chunk)
    }
    if (Number.isFinite(delay)) schedule(delay)
  }
  async function loadCookies() {
    const epoch = ++cookieGeneration
    invalidateCookies()
    cookieProblem.value = null
    try {
      await ensureOps()
      const result = await session.consentRequest('/api/v1/consents/cookies')
      if (epoch === cookieGeneration) applyCookies(result)
    } catch (problem) { if (epoch === cookieGeneration) cookieProblem.value = problem; throw problem }
  }
  async function decideCookies(document, decision, categories, key = globalThis.crypto.randomUUID()) {
    const epoch = ++cookieGeneration
    invalidateCookies()
    cookieProblem.value = null
    try {
      const result = await session.consentRequest('/api/v1/consents/cookies', json('POST', {
        documentId:document.id, contentHash:document.contentHash, decision, categories, idempotencyKey:key
      }))
      if (epoch === cookieGeneration) applyCookies(result)
      if (session.customer.value) await session.consentRequest('/api/v1/consents/me/browser', { method:'POST' }, true)
    } catch (problem) { if (epoch === cookieGeneration) cookieProblem.value = problem; throw problem }
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
      throw createInternalProblem('invalidInput', { detail:'Откройте «Мои согласия и обращения» и дайте актуальное согласие. Введённые данные сохранены в форме.' })
    }
  }
  async function grant(document, key = globalThis.crypto.randomUUID()) {
    await session.consentRequest('/api/v1/consents/me/personal-data', json('POST', {
      documentId:document.id, contentHash:document.contentHash, decision:'grant', categories:[], idempotencyKey:key
    }), true)
    await loadMine()
  }
  async function requestWithdrawal() {
    await session.consentRequest('/api/v1/consents/me/withdrawal-request', { method:'POST' }, true)
    await loadMine()
  }
  async function associate() {
    if (session.customer.value) await session.consentRequest('/api/v1/consents/me/browser', { method:'POST' }, true)
  }
function dispose() { cookieGeneration++; globalThis.clearTimeout(timer); invalidateCookies(); resetCustomer() }
  return { cookies:readonly(cookies), mine:readonly(mine), ops:readonly(ops), serviceAllowed:readonly(serviceAllowed), opsProblem:readonly(opsProblem),
    cookieProblem:readonly(cookieProblem), personalProblem:readonly(personalProblem), current, read, source, loadOps, ensureOps,
    kindByAlias, kindName, routeAlias, cookieCategoryName, requiredCookieCategories, loadCookies, decideCookies, loadMine, requirePersonalData, grant, requestWithdrawal, associate, resetCustomer, dispose }
}
let store
export function useConsents() { return store ??= createConsentStore(useSession()) }
export function resetConsentsForTests() {
  store?.dispose()
  store = undefined
}
