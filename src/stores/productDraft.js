// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { readonly, ref } from 'vue'

import { normalizeProductAddress } from '../productAddress.js'

export const PRODUCT_DRAFT_STORAGE_KEY = 'sarafan.product-draft.v1'
const VERSION = 1
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const RESUME_MODES = new Set(['none', 'authentication', 'consent'])
let draftState

function storage() {
  try { return globalThis.sessionStorage }
  catch { return null }
}

function removeStored() {
  try { storage()?.removeItem(PRODUCT_DRAFT_STORAGE_KEY) }
  catch { /* Storage is optional; the in-memory draft remains usable. */ }
}

function validate(value) {
  if (!value || value.version !== VERSION || typeof value.sourceUrl !== 'string'
    || typeof value.quantity !== 'string' || value.quantity.length > 20
    || typeof value.comment !== 'string' || value.comment.length > 2000
    || value.idempotencyKey !== null && (typeof value.idempotencyKey !== 'string' || !UUID.test(value.idempotencyKey))
    || !RESUME_MODES.has(value.resumeMode)
    || value.boundCustomerId !== null && (!Number.isInteger(value.boundCustomerId) || value.boundCustomerId <= 0)) return null
  const sourceUrl = normalizeProductAddress(value.sourceUrl)
  if (!sourceUrl) return null
  if (value.resumeMode === 'consent' && value.boundCustomerId === null
    || value.resumeMode !== 'consent' && value.boundCustomerId !== null) return null
  return { ...value, sourceUrl }
}

function readStored() {
  try {
    const serialized = storage()?.getItem(PRODUCT_DRAFT_STORAGE_KEY)
    if (!serialized) return null
    const value = validate(JSON.parse(serialized))
    if (!value) removeStored()
    return value
  } catch {
    removeStored()
    return null
  }
}

function state() {
  draftState ??= ref(readStored())
  return draftState
}

function save(value) {
  state().value = value
  if (!value) {
    removeStored()
    return
  }
  try { storage()?.setItem(PRODUCT_DRAFT_STORAGE_KEY, JSON.stringify(value)) }
  catch { /* Continue with the in-memory draft when storage is unavailable. */ }
}

function payloadChanged(current, changes) {
  const next = { ...current, ...changes }
  return normalizeProductAddress(next.sourceUrl) !== normalizeProductAddress(current.sourceUrl)
    || Number(next.quantity) !== Number(current.quantity)
    || next.comment.trim() !== current.comment.trim()
}

export function useProductDraft() {
  function start(sourceUrl) {
    const normalized = normalizeProductAddress(sourceUrl)
    if (!normalized) return false
    save({
      version:VERSION,
      sourceUrl:normalized,
      quantity:'1',
      comment:'',
      idempotencyKey:null,
      resumeMode:'none',
      boundCustomerId:null
    })
    return true
  }

  function update(changes) {
    const current = state().value
    if (!current) return false
    const next = { ...current, ...changes }
    if (payloadChanged(current, changes)) {
      next.idempotencyKey = null
      next.resumeMode = 'none'
      next.boundCustomerId = null
    }
    const validated = validate(next)
    if (!validated) return false
    save(validated)
    return true
  }

  function setCanonicalSourceUrl(sourceUrl) {
    const normalized = normalizeProductAddress(sourceUrl)
    return normalized ? update({ sourceUrl:normalized }) : false
  }

  function ensureIdempotencyKey() {
    const current = state().value
    if (!current) return null
    if (current.idempotencyKey) return current.idempotencyKey
    const idempotencyKey = globalThis.crypto.randomUUID()
    save({ ...current, idempotencyKey })
    return idempotencyKey
  }

  function markAuthenticationResume() {
    const current = state().value
    if (current) save({ ...current, resumeMode:'authentication', boundCustomerId:null })
  }

  function markConsentResume(customerId) {
    const current = state().value
    if (current && Number.isInteger(customerId) && customerId > 0) {
      save({ ...current, resumeMode:'consent', boundCustomerId:customerId })
    }
  }

  function clearResume() {
    const current = state().value
    if (current) save({ ...current, resumeMode:'none', boundCustomerId:null })
  }

  function clear() { save(null) }

  return {
    draft:readonly(state()),
    start,
    update,
    setCanonicalSourceUrl,
    ensureIdempotencyKey,
    markAuthenticationResume,
    markConsentResume,
    clearResume,
    clear
  }
}

export function resetProductDraftForTests() {
  draftState = undefined
  removeStored()
}
