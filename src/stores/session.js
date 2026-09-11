// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { readonly, ref } from 'vue'

import { API_BASE_PATH } from '../api.js'
import { createApiClient } from '../api/client.js'
import {
  CORE_PROBLEM_TYPES,
  INTERNAL_PROBLEM_TYPES,
  ProblemError,
  createInternalProblem,
  isServiceUnavailableProblem
} from '../errors/problem.js'
import { EVENTS } from '../observability/catalogue.js'
import { uiLogger } from '../observability/logger.js'
import { problemAttributes, problemContext } from '../observability/problem-reporting.js'

const accessToken = ref('')
const customer = ref(null)
const restoring = ref(true)
const restoreProblem = ref(null)
const notice = ref('')
let refreshPromise = null
let opsPromise = null
const authenticationOps = ref(null)
const customerOps = ref(null)
const SERVICE_UNAVAILABLE_MESSAGE = 'Сервис недоступен. Пожалуйста, повторите позже.'
const REQUIRED_AUTHENTICATION_ALIASES = ['code', 'agreement', 'registration']
const REQUIRED_CUSTOMER_ALIASES = ['preliminary', 'complete', 'disabled']

function serviceUnavailableProblem(problem) {
  return problem?.type === INTERNAL_PROBLEM_TYPES.serviceUnavailable
    ? problem
    : createInternalProblem('serviceUnavailable', { cause:problem })
}

function applySession(session) {
  if (!session?.customer || !customerOps.value || !Number.isInteger(session.customer.state)
    || !customerOps.value.states.some(item => item.value === session.customer.state)) {
    throw createInternalProblem('protocolError')
  }
  accessToken.value = session.accessToken
  customer.value = session.customer
  notice.value = ''
  return session.customer
}

function validateEnumOps(value, property, requiredAliases) {
  const items = value?.[property]
  if (!Array.isArray(items) || items.length === 0) throw createInternalProblem('protocolError')
  const values = new Set()
  const aliases = new Set()
  for (const item of items) {
    if (!item || !Number.isInteger(item.value) || item.value < 0 || typeof item.name !== 'string' || !item.name.trim()
      || typeof item.routeAlias !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(item.routeAlias)
      || values.has(item.value) || aliases.has(item.routeAlias)) throw createInternalProblem('protocolError')
    values.add(item.value)
    aliases.add(item.routeAlias)
  }
  if (requiredAliases.some(alias => !aliases.has(alias))) throw createInternalProblem('protocolError')
  return { [property]:items.map(item => ({ value:item.value, name:item.name, routeAlias:item.routeAlias })) }
}

async function ensureOps() {
  if (authenticationOps.value && customerOps.value) return
  if (!opsPromise) {
    opsPromise = Promise.all([
      client.request(`${API_BASE_PATH}/auth/ops`),
      client.request(`${API_BASE_PATH}/customers/ops`)
    ]).then(([auth, customers]) => {
      const validatedAuthentication = validateEnumOps(auth, 'steps', REQUIRED_AUTHENTICATION_ALIASES)
      const validatedCustomers = validateEnumOps(customers, 'states', REQUIRED_CUSTOMER_ALIASES)
      authenticationOps.value = validatedAuthentication
      customerOps.value = validatedCustomers
    }).finally(() => { opsPromise = null })
  }
  await opsPromise
}

function flowValue(alias) {
  return authenticationOps.value?.steps.find(item => item.routeAlias === alias)?.value
}

function clearSession(message = '') {
  accessToken.value = ''
  customer.value = null
  notice.value = message
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }
}

const client = createApiClient({
  getAccessToken: () => accessToken.value,
  refreshSession: operationTrace => refreshSession(operationTrace)
})

async function refreshSession(operationTrace) {
  if (!refreshPromise) {
    refreshPromise = ensureOps()
      .then(() => client.request(
        `${API_BASE_PATH}/auth/refresh`,
        { method: 'POST' },
        { operationTrace }
      ))
      .catch((error) => {
        if (isServiceUnavailableProblem(error)) {
          const problem = serviceUnavailableProblem(error)
          clearSession(SERVICE_UNAVAILABLE_MESSAGE)
          throw problem
        }
        clearSession()
        throw error
      })
      .then(applySession)
      .finally(() => {
        refreshPromise = null
      })
  }

  return refreshPromise
}

async function restoreSession() {
  restoring.value = true
  restoreProblem.value = null
  try {
    await refreshSession()
  } catch (error) {
    if (!(error instanceof ProblemError) || error.type !== CORE_PROBLEM_TYPES.invalidRefreshToken) {
      const problem = createInternalProblem('sessionRestoreUnavailable', { cause: error })
      restoreProblem.value = problem
      uiLogger.log(
        EVENTS.sessionRestoreFailed,
        problemAttributes(problem),
        problemContext(error)
      )
    }
  } finally {
    restoring.value = false
  }
}

async function resolvePhone(phone) {
  notice.value = ''
  try {
    await ensureOps()
    const result = await client.request(
      `${API_BASE_PATH}/auth/phone/resolve`,
      jsonOptions('POST', { phone })
    )
    if (!result || !Number.isInteger(result.nextStep)
      || !authenticationOps.value.steps.some(item => item.value === result.nextStep)
      || !Array.isArray(result.requiredDocumentKinds)
      || result.requiredDocumentKinds.some(kind => !Number.isInteger(kind))
      || new Set(result.requiredDocumentKinds).size !== result.requiredDocumentKinds.length) throw createInternalProblem('protocolError')
    return result
  } catch (error) {
    throw isServiceUnavailableProblem(error) ? serviceUnavailableProblem(error) : error
  }
}

async function requestCode(phone, consents = {}) {
  notice.value = ''
  try {
    const receipt = await client.request(
      `${API_BASE_PATH}/auth/code/request`,
      jsonOptions('POST', { phone, ...consents })
    )
    const token = receipt?.onboardingToken
    if (!receipt || !Object.hasOwn(receipt, 'onboardingToken')
      || token !== null && (typeof token !== 'string' || token.length < 32 || token.length > 128)) {
      throw createInternalProblem('protocolError')
    }
    return { onboardingToken:token }
  } catch (error) {
    throw isServiceUnavailableProblem(error) ? serviceUnavailableProblem(error) : error
  }
}

async function getStatus() {
  return client.request(`${API_BASE_PATH}/status/status`)
}

// Consent failures remain recoverable so legal documents and the manual withdrawal request stay accessible.
async function consentRequest(path, options = {}, authorize = false, responseType = 'json') {
  if (!/^\/api\/v1\/(legal\/(ops|current\/\d+|documents\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}(?:\/source)?)|consents\/(cookies|me(?:\/(personal-data|browser|withdrawal-request))?))$/iu.test(path)) {
    throw createInternalProblem('invalidInput')
  }
  return client.request(path, options, { authorize, responseType })
}

async function verifyCode(payload) {
  notice.value = ''
  let session
  try {
    await ensureOps()
    session = await client.request(
      `${API_BASE_PATH}/auth/code/verify`,
      jsonOptions('POST', payload)
    )
  } catch (error) {
    if (isServiceUnavailableProblem(error)) {
      const problem = serviceUnavailableProblem(error)
      clearSession(SERVICE_UNAVAILABLE_MESSAGE)
      throw problem
    }
    throw error
  }
  return applySession(session)
}

async function logout() {
  try {
    await client.request(`${API_BASE_PATH}/auth/logout`, { method: 'POST' })
  } finally {
    clearSession()
  }
}

async function authorizedRequest(path, options = {}, policy = {}) {
  try {
    return await client.request(path, options, { ...policy, authorize:true })
  } catch (error) {
    if (isServiceUnavailableProblem(error)) {
      const problem = serviceUnavailableProblem(error)
      clearSession(SERVICE_UNAVAILABLE_MESSAGE)
      throw problem
    }
    throw error
  }
}

async function updateProfile(profile) {
  customer.value = await authorizedRequest(
    `${API_BASE_PATH}/customers/me`,
    jsonOptions('PUT', profile)
  )
  return customer.value
}

async function uploadPhoto(file) {
  const body = new globalThis.FormData()
  body.append('file', file)
  await authorizedRequest(
    `${API_BASE_PATH}/customers/me/photo`,
    { method: 'PUT', body }
  )
  customer.value = { ...customer.value, hasPhoto: true }
}

async function deletePhoto() {
  await authorizedRequest(
    `${API_BASE_PATH}/customers/me/photo`,
    { method: 'DELETE' }
  )
  customer.value = { ...customer.value, hasPhoto: false }
}

async function getPhoto() {
  return authorizedRequest(
    `${API_BASE_PATH}/customers/me/photo`,
    {},
    { responseType: 'blob' }
  )
}

export function useSession() {
  return {
    customer: readonly(customer),
    restoring: readonly(restoring),
    restoreProblem: readonly(restoreProblem),
    notice: readonly(notice),
    restoreSession,
    getStatus,
    consentRequest,
    ensureOps,
    flowValue,
    resolvePhone,
    requestCode,
    verifyCode,
    logout,
    updateProfile,
    uploadPhoto,
    deletePhoto,
    getPhoto
  }
}

export function resetSessionForTests() {
  clearSession()
  restoring.value = true
  restoreProblem.value = null
  notice.value = ''
  refreshPromise = null
  opsPromise = null
  authenticationOps.value = null
  customerOps.value = null
}
