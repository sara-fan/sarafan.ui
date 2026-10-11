// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { isRfc3339DateTime } from './api/validation.js'
import { createInternalProblem } from './errors/problem.js'

export function validateOrderStages(value, createdAt, updatedAt) {
  if (!Array.isArray(value)) throw createInternalProblem('protocolError')
  const statuses = new Set()
  let previous = Date.parse(createdAt)
  return value.map(stage => {
    if (!stage || !Number.isInteger(stage.status) || stage.status < 0 || statuses.has(stage.status)
      || !isRfc3339DateTime(stage.at) || Date.parse(stage.at) < previous || Date.parse(stage.at) > Date.parse(updatedAt)) {
      throw createInternalProblem('protocolError')
    }
    statuses.add(stage.status)
    previous = Date.parse(stage.at)
    return { status:stage.status, at:stage.at }
  })
}
