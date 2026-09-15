// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

const MAXIMUM_URL_LENGTH = 65535
const EXPLICIT_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u
const DOTTED_HOST_WITH_PORT = /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?:\.)?|\[[0-9A-Fa-f:.]+\]):[0-9]+(?:[/?#]|$)/u
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu
const IPV4_ADDRESS = /^(?:\d{1,3}\.){3}\d{1,3}$/u

function hasValidHostnameSyntax(hostname) {
  const normalized = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname
  const labels = normalized.split('.')
  return normalized.length <= 253 && !IPV4_ADDRESS.test(normalized)
    && labels.length > 1 && labels.every(label => DNS_LABEL.test(label))
}

function hasListedSuffix(hostname, topLevelDomains) {
  const normalized = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname
  return topLevelDomains.includes(normalized.split('.').at(-1).toUpperCase())
}

export function normalizeProductAddress(value, productSourceUrlOps = null) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const maximumLength = productSourceUrlOps?.maximumLength ?? MAXIMUM_URL_LENGTH
  if (!trimmed || trimmed.length > maximumLength || /\s/u.test(trimmed)) return null

  let candidate
  if (trimmed.startsWith('//')) candidate = `https:${trimmed}`
  else if (/^https?:\/\//iu.test(trimmed)) {
    const authority = trimmed.slice(trimmed.indexOf('//') + 2)
    if (!authority || /^[/?#]/u.test(authority)) return null
    candidate = trimmed
  }
  else if (EXPLICIT_SCHEME.test(trimmed) && !DOTTED_HOST_WITH_PORT.test(trimmed)) return null
  else candidate = `https://${trimmed}`

  try {
    const url = new globalThis.URL(candidate)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password
      || !hasValidHostnameSyntax(url.hostname)
      || productSourceUrlOps && !hasListedSuffix(url.hostname, productSourceUrlOps.topLevelDomains)) return null
    return url.href.length <= maximumLength ? url.href : null
  } catch {
    return null
  }
}
