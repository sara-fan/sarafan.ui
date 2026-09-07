// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { h } from 'vue'
import { createInternalProblem } from './errors/problem.js'

export const LEGAL_DOCUMENT_KIND = Object.freeze({
  COOKIE_CONSENT:0,
  PERSONAL_DATA_CONSENT:1,
  USER_AGREEMENT:2,
  ORDER_RULES:3,
  PRIVACY_POLICY:4
})
export const CONSENT_STATUSES = Object.freeze({ current:'Актуально', missing:'Не принято', 'renewal-required':'Требуется новое согласие',
  withdrawn:'Отозвано', refused:'Отказ', unavailable:'Документ недоступен',
  grant:'Принято', refuse:'Отказ', withdraw:'Отозвано' })
const tags = new Set(['p','h1','h2','h3','h4','h5','h6','ul','ol','li','strong','em','a','br','table','thead','tbody','tr','th','td'])
export const isDocumentId = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(value)
export function moscowTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return `${new Intl.DateTimeFormat('ru-RU', { dateStyle:'short', timeStyle:'short', timeZone:'Europe/Moscow' }).format(date)} МСК`
}
export function documentNodes(html) {
  if (typeof html !== 'string' || html.length > 2 * 1024 * 1024) throw createInternalProblem('protocolError')
  // A template is inert. Only allowlisted elements/attributes become Vue nodes; source HTML is never mounted.
  const template = document.createElement('template')
  template.innerHTML = html
  function visit(node) {
    if (node.nodeType === 3) return node.textContent
    const tag = node.nodeName.toLowerCase()
    if (node.nodeType !== 1 || !tags.has(tag)) throw createInternalProblem('protocolError')
    const props = {}
    for (const attribute of node.attributes) {
      if (tag === 'a' && attribute.name === 'href') {
        let url
        try { url = new globalThis.URL(attribute.value) } catch { throw createInternalProblem('protocolError') }
        if (!['https:','http:','mailto:'].includes(url.protocol)) throw createInternalProblem('protocolError')
        props.href = url.href
        props.rel = 'noopener noreferrer'
      } else if (tag === 'a' && attribute.name === 'title') props.title = attribute.value
      else if (tag === 'ol' && attribute.name === 'start' && /^\d{1,9}$/u.test(attribute.value)) props.start = Number(attribute.value)
      else if (['th','td'].includes(tag) && attribute.name === 'style' && /^text-align:\s*(left|right|center);?$/u.test(attribute.value)) props.style = attribute.value
      else throw createInternalProblem('protocolError')
    }
    return h(tag, props, [...node.childNodes].map(visit))
  }
  return [...template.content.childNodes].map(visit)
}

export function downloadBytes(blob, id) {
  const url = globalThis.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `consent-${id}.md`
  anchor.click()
  globalThis.setTimeout(() => globalThis.URL.revokeObjectURL(url), 0)
}
