// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { createErrorBoundaries } from '@sara-fan/ui-shared/observability/boundaries'
import { normalizeProblem } from '../errors/problem.js'
import { EVENTS } from './catalogue.js'
import { uiLogger } from './logger.js'
import { isHandled, markHandled } from './deduplication.js'
export const { reportBoundaryFailure, installErrorBoundaries } = createErrorBoundaries({ normalizeProblem, events: EVENTS, logger: uiLogger, isHandled, markHandled })
