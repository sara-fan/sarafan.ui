// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { createHttpTools } from '@sara-fan/ui-shared/http'
import { CORE_PROBLEM_TYPES, createInternalProblem, normalizeProblem } from '../errors/problem.js'
import { EVENTS } from '../observability/catalogue.js'
import { uiLogger } from '../observability/logger.js'
import { isHandled, markHandled } from '../observability/deduplication.js'
export { JSON_ACCEPT } from '@sara-fan/ui-shared/http'
export const PHOTO_ACCEPT = 'image/avif, image/webp, image/png, image/jpeg, application/problem+json'

const API_ROUTE_TEMPLATES = new Set([
  '/api/v1/legal/ops',
  '/api/v1/legal/current/{kind}',
  '/api/v1/legal/documents/{id}',
  '/api/v1/legal/documents/{id}/source',
  '/api/v1/consents/cookies',
  '/api/v1/consents/me',
  '/api/v1/consents/me/personal-data',
  '/api/v1/consents/me/browser',
  '/api/v1/consents/me/withdrawal-request',
  '/api/v1/auth/code/request',
  '/api/v1/auth/code/verify',
  '/api/v1/auth/logout',
  '/api/v1/auth/refresh',
  '/api/v1/customers/me',
  '/api/v1/customers/me/photo',
  '/api/v1/status/status'
])

function routeTemplate(path) {
  try {
    const pathname = new globalThis.URL(path, 'https://sarafan.invalid').pathname.replace(/(\/legal\/current\/)\d+$/u, '$1{kind}').replace(/(\/legal\/documents\/)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/source$|$)/iu, '$1{id}')
    return API_ROUTE_TEMPLATES.has(pathname) ? pathname : undefined
  } catch {
    return undefined
  }
}

function shouldReportFailure(problem, retryCount) {
  if (problem.type === CORE_PROBLEM_TYPES.validationFailed
    || problem.type === CORE_PROBLEM_TYPES.loginFailed
    || problem.type === CORE_PROBLEM_TYPES.invalidRefreshToken) return false
  if (problem.type === CORE_PROBLEM_TYPES.invalidAccessToken) return retryCount > 0
  return true
}

export const { createApiClient, parseProblemResponse } = createHttpTools({ createInternalProblem, normalizeProblem, isHandled, markHandled, logger: uiLogger, failedEvent: EVENTS.apiRequestFailed, routeTemplate, shouldReportFailure, invalidAccessTokenType: CORE_PROBLEM_TYPES.invalidAccessToken, binaryAccept: PHOTO_ACCEPT })
