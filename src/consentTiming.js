// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { createInternalProblem } from './errors/problem.js'

export function nextChangeDelay(envelope) {
  if (envelope?.nextChangeAt == null) return null
  const delay = Date.parse(envelope.nextChangeAt) - Date.parse(envelope.serverNow)
  if (!Number.isFinite(delay) || delay <= 0) throw createInternalProblem('protocolError')
  return delay
}
export function scheduleBoundary(delay, assign, action) {
  function schedule(remaining) {
    const chunk = Math.min(remaining, 2147483647)
    assign(globalThis.setTimeout(() => {
      if (remaining > chunk) schedule(remaining - chunk)
      else action()
    }, chunk))
  }
  schedule(delay)
}
