// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { createLogger as createSharedLogger } from '@sara-fan/ui-shared/observability/logger'
import { version } from '../../package.json'
import { runtimeConfig } from '../config/runtime.js'
import { EVENTS, SEVERITY, isCatalogueEvent } from './catalogue.js'

export function createLogger({
  enabled = runtimeConfig.loggingEnabled,
  minimumSeverity = runtimeConfig.minimumSeverity,
  environment = import.meta.env.MODE || 'unknown',
  sink, now, rateLimit
} = {}) {
  return createSharedLogger({
    enabled, minimumSeverity, environment, sink, now, rateLimit,
    serviceName: 'sarafan.ui', version,
    events: EVENTS, severity: SEVERITY, isCatalogueEvent
  })
}
export const uiLogger = createLogger()
