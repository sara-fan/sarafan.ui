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
  createInternalProblem
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
const SERVICE_UNAVAILABLE_MESSAGE = 'Сервис недоступен. Пожалуйста, повторите позже.'

function isServiceUnavailable(problem) {
  return problem?.type === INTERNAL_PROBLEM_TYPES.protocolError
    || problem?.type === INTERNAL_PROBLEM_TYPES.serviceUnavailable
    || (Number.isInteger(problem?.status) && problem.status >= 500)
}

function serviceUnavailableProblem(problem) {
  return problem?.type === INTERNAL_PROBLEM_TYPES.serviceUnavailable
    ? problem
    : createInternalProblem('serviceUnavailable', { cause:problem })
}

function applySession(session) {
  accessToken.value = session.accessToken
  customer.value = session.customer
  notice.value = ''
  return session.customer
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
    refreshPromise = client.request(
      `${API_BASE_PATH}/auth/refresh`,
      { method: 'POST' },
      { operationTrace }
    )
      .catch((error) => {
        if (isServiceUnavailable(error)) {
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

async function requestCode(phone, purpose, consents = {}) {
  notice.value = ''
  try {
    return await client.request(
      `${API_BASE_PATH}/auth/code/request`,
      jsonOptions('POST', { phone, purpose, ...consents })
    )
  } catch (error) {
    throw isServiceUnavailable(error) ? serviceUnavailableProblem(error) : error
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
    session = await client.request(
      `${API_BASE_PATH}/auth/code/verify`,
      jsonOptions('POST', payload)
    )
  } catch (error) {
    if (isServiceUnavailable(error)) {
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
    if (isServiceUnavailable(error)) {
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
}
