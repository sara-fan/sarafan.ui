// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { isRfc3339DateTime } from './api/validation.js'
import { createInternalProblem } from './errors/problem.js'

export function validateOrderStages(value, createdAt, updatedAt, status, ops) {
  const sequence = [300, 350, 400]
  const current = ops.statuses.find(item => item.value === status)
  const currentIndex = sequence.indexOf(status)
  const maximum = !current ? sequence.length - 1 : currentIndex >= 0 ? currentIndex
    : current.upperStatusRouteAlias === 'in_progress' ? 0 : -1
  let previousIndex = -1
  if (!Array.isArray(value)) throw createInternalProblem('protocolError')
  let previous = Date.parse(createdAt)
  return value.map(stage => {
    const index = sequence.indexOf(stage?.status)
    if (index < 0 || index <= previousIndex || index > maximum || !ops.statuses.some(item => item.value === stage.status)
      || !stage || !Number.isInteger(stage.status) || stage.status < 0
      || !isRfc3339DateTime(stage.at) || Date.parse(stage.at) < previous || Date.parse(stage.at) > Date.parse(updatedAt)) {
      throw createInternalProblem('protocolError')
    }
    previousIndex = index
    previous = Date.parse(stage.at)
    return { status:stage.status, at:stage.at }
  })
}
