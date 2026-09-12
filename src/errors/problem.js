// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { PROBLEM_TYPE_ROOT, ProblemError, createProblemTools } from '@sara-fan/ui-shared/problems'
import { EVENTS } from '../observability/catalogue.js'
import { uiLogger } from '../observability/logger.js'
export { PROBLEM_TYPE_ROOT, ProblemError } from '@sara-fan/ui-shared/problems'

export const CORE_PROBLEM_TYPES = Object.freeze({
  authenticationRequirementsChanged: `${PROBLEM_TYPE_ROOT}authentication-requirements-changed`,
  consentVersionChanged: `${PROBLEM_TYPE_ROOT}consent-version-changed`,
  customerNotFound: `${PROBLEM_TYPE_ROOT}customer-not-found`,
  invalidAuthRequest: `${PROBLEM_TYPE_ROOT}invalid-auth-request`,
  invalidAccessToken: `${PROBLEM_TYPE_ROOT}invalid-access-token`,
  invalidCode: `${PROBLEM_TYPE_ROOT}invalid-code`,
  invalidRefreshToken: `${PROBLEM_TYPE_ROOT}invalid-refresh-token`,
  loginFailed: `${PROBLEM_TYPE_ROOT}login-failed`,
  onboardingConsentExpired: `${PROBLEM_TYPE_ROOT}onboarding-consent-expired`,
  validationFailed: `${PROBLEM_TYPE_ROOT}validation-failed`
})

export const { INTERNAL_PROBLEM_TYPES, createInternalProblem, normalizeProblem, presentProblem, problemFieldErrors, suppressProblem } = createProblemTools({
  logger: uiLogger,
  suppressedEvent: EVENTS.operationSuppressed,
  additions: {
    serviceUnavailable: {
      suffix: 'service-unavailable',
      code: 'ui_service_unavailable',
      title: 'Сервис недоступен',
      detail: 'Сервис недоступен. Пожалуйста, повторите позже.'
    },
    photoPreviewUnavailable: {
      suffix: 'photo-preview-unavailable',
      code: 'ui_photo_preview_unavailable',
      title: 'Не удалось загрузить фотографию',
      detail: 'Фотография недоступна. Вы можете продолжить редактирование профиля'
    }
  }
})

export function isServiceUnavailableProblem(problem) {
  return problem?.type === INTERNAL_PROBLEM_TYPES.networkUnavailable
    || problem?.type === INTERNAL_PROBLEM_TYPES.protocolError
    || problem?.type === INTERNAL_PROBLEM_TYPES.serviceUnavailable
    || (problem instanceof ProblemError && problem.type.startsWith(PROBLEM_TYPE_ROOT)
      && Number.isInteger(problem.status) && problem.status >= 500)
}
