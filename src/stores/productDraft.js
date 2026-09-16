// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { readonly, ref } from 'vue'

import { priceCents, PRODUCT_FIELDS } from '../orderProduct.js'
import { normalizeProductAddress } from '../productAddress.js'

export const PRODUCT_DRAFT_STORAGE_KEY = 'sarafan.product-draft.v2'
const LEGACY_STORAGE_KEY = 'sarafan.product-draft.v1'
const VERSION = 2
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const RESUME_MODES = new Set(['none', 'authentication', 'consent'])
const PREVIEW_OUTCOMES = new Set(['manual_review', 'recognized'])
const PAYLOAD_FIELDS = new Set(PRODUCT_FIELDS)
const FIELD_LIMITS = Object.freeze({
  storeName:2000,
  productName:4000,
  sellerPrice:64,
  quantity:20,
  color:2000,
  size:2000,
  comment:10000
})
let draftState

function storage() {
  try { return globalThis.sessionStorage }
  catch { return null }
}

function removeKey(key) {
  try { storage()?.removeItem(key) }
  catch { /* Storage is optional; the in-memory draft remains usable. */ }
}

function removeStored() {
  removeKey(PRODUCT_DRAFT_STORAGE_KEY)
  removeKey(LEGACY_STORAGE_KEY)
}

function validTextFields(value) {
  return Object.entries(FIELD_LIMITS).every(([key, maximum]) => typeof value[key] === 'string' && value[key].length <= maximum)
}

function validate(value) {
  if (!value || value.version !== VERSION || typeof value.sourceUrl !== 'string'
    || !validTextFields(value)
    || value.idempotencyKey !== null && (typeof value.idempotencyKey !== 'string' || !UUID.test(value.idempotencyKey))
    || !RESUME_MODES.has(value.resumeMode)
    || value.boundCustomerId !== null && (!Number.isInteger(value.boundCustomerId) || value.boundCustomerId <= 0)
    || typeof value.previewApplied !== 'boolean'
    || value.previewOutcome !== null && !PREVIEW_OUTCOMES.has(value.previewOutcome)
    || value.previewApplied !== (value.previewOutcome !== null)
    || !Array.isArray(value.dirtyFields)
    || value.dirtyFields.some(field => !PAYLOAD_FIELDS.has(field))
    || new Set(value.dirtyFields).size !== value.dirtyFields.length) return null
  const sourceUrl = normalizeProductAddress(value.sourceUrl)
  if (!sourceUrl) return null
  if (value.resumeMode === 'consent' && value.boundCustomerId === null
    || value.resumeMode !== 'consent' && value.boundCustomerId !== null) return null
  return {
    version:VERSION,
    sourceUrl,
    storeName:value.storeName,
    productName:value.productName,
    sellerPrice:value.sellerPrice,
    quantity:value.quantity,
    color:value.color,
    size:value.size,
    comment:value.comment,
    previewApplied:value.previewApplied,
    previewOutcome:value.previewOutcome,
    dirtyFields:[...value.dirtyFields],
    idempotencyKey:value.idempotencyKey,
    resumeMode:value.resumeMode,
    boundCustomerId:value.boundCustomerId
  }
}

function migrateLegacy(value) {
  if (!value || value.version !== 1 || typeof value.sourceUrl !== 'string'
    || typeof value.quantity !== 'string' || value.quantity.length > FIELD_LIMITS.quantity
    || typeof value.comment !== 'string' || value.comment.length > 2000) return null
  const sourceUrl = normalizeProductAddress(value.sourceUrl)
  if (!sourceUrl) return null
  return validate({
    version:VERSION,
    sourceUrl,
    storeName:'',
    productName:'',
    sellerPrice:'',
    quantity:value.quantity,
    color:'',
    size:'',
    comment:value.comment,
    previewApplied:false,
    previewOutcome:null,
    dirtyFields:['quantity', 'comment'],
    idempotencyKey:null,
    resumeMode:'none',
    boundCustomerId:null
  })
}

function parseStored(key, validator) {
  try {
    const serialized = storage()?.getItem(key)
    if (!serialized) return null
    const value = validator(JSON.parse(serialized))
    if (!value) removeKey(key)
    return value
  } catch {
    removeKey(key)
    return null
  }
}

function persist(value) {
  try {
    const target = storage()
    if (!target) return false
    target.setItem(PRODUCT_DRAFT_STORAGE_KEY, JSON.stringify(value))
    removeKey(LEGACY_STORAGE_KEY)
    return true
  } catch {
    // Continue with the in-memory draft and retain a legacy draft when migration cannot persist.
    return false
  }
}

function readStored() {
  const current = parseStored(PRODUCT_DRAFT_STORAGE_KEY, validate)
  if (current) return current
  const migrated = parseStored(LEGACY_STORAGE_KEY, migrateLegacy)
  if (migrated) persist(migrated)
  return migrated
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
  persist(value)
}

function normalizedPrice(value) {
  const cents = priceCents(value)
  return cents === null ? String(value).trim().replace(',', '.') : cents.toString()
}

function normalizedQuantity(value) {
  const raw = String(value).trim()
  return /^\d+$/u.test(raw) ? String(Number(raw)) : raw
}

function payloadFingerprint(value) {
  return JSON.stringify({
    sourceUrl:normalizeProductAddress(value.sourceUrl),
    storeName:value.storeName.trim(),
    productName:value.productName.trim(),
    sellerPrice:normalizedPrice(value.sellerPrice),
    quantity:normalizedQuantity(value.quantity),
    color:value.color.trim(),
    size:value.size.trim(),
    comment:value.comment.trim()
  })
}

function payloadChanged(current, next) {
  return payloadFingerprint(current) !== payloadFingerprint(next)
}

export function useProductDraft() {
  function start(sourceUrl) {
    const normalized = normalizeProductAddress(sourceUrl)
    if (!normalized) return false
    save({
      version:VERSION,
      sourceUrl:normalized,
      storeName:'',
      productName:'',
      sellerPrice:'',
      quantity:'',
      color:'',
      size:'',
      comment:'',
      previewApplied:false,
      previewOutcome:null,
      dirtyFields:[],
      idempotencyKey:null,
      resumeMode:'none',
      boundCustomerId:null
    })
    return true
  }

  function update(changes) {
    const current = state().value
    if (!current) return false
    const changedFields = Object.keys(changes).filter(field => PAYLOAD_FIELDS.has(field))
    const next = {
      ...current,
      ...changes,
      dirtyFields:[...new Set([...current.dirtyFields, ...changedFields])]
    }
    if (payloadChanged(current, next)) {
      next.idempotencyKey = null
      next.resumeMode = 'none'
      next.boundCustomerId = null
    }
    const validated = validate(next)
    if (!validated) return false
    save(validated)
    return true
  }

  function applyPreview(sourceUrl, outcome, prefill) {
    const current = state().value
    const normalized = normalizeProductAddress(sourceUrl)
    if (!current || !normalized || !PREVIEW_OUTCOMES.has(outcome) || !validTextFields(prefill)) return false
    const next = { ...current, sourceUrl:normalized, previewApplied:true, previewOutcome:outcome }
    if (!current.previewApplied) {
      for (const field of PRODUCT_FIELDS) {
        if (!current.dirtyFields.includes(field)) next[field] = prefill[field]
      }
    }
    if (payloadChanged(current, next)) next.idempotencyKey = null
    const validated = validate(next)
    save(validated)
    return true
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
    applyPreview,
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
