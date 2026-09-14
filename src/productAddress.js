// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

const MAXIMUM_URL_LENGTH = 2048
const EXPLICIT_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u
const HOST_WITH_PORT = /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:.]+\]):[0-9]+(?:[/?#]|$)/u

export function normalizeProductAddress(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || /\s/u.test(trimmed)) return null

  let candidate
  if (trimmed.startsWith('//')) candidate = `https:${trimmed}`
  else if (/^https?:\/\//iu.test(trimmed)) {
    const authority = trimmed.slice(trimmed.indexOf('//') + 2)
    if (!authority || /^[/?#]/u.test(authority)) return null
    candidate = trimmed
  }
  else if (EXPLICIT_SCHEME.test(trimmed) && !HOST_WITH_PORT.test(trimmed)) return null
  else candidate = `https://${trimmed}`

  try {
    const url = new globalThis.URL(candidate)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return null
    return url.href.length <= MAXIMUM_URL_LENGTH ? url.href : null
  } catch {
    return null
  }
}
