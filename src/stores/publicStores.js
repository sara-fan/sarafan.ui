// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, inject, reactive, ref } from 'vue'
import { createApiClient } from '../api/client.js'
import { createInternalProblem, normalizeProblem } from '../errors/problem.js'

export const PUBLIC_STORES = Symbol('publicStores')
export const STORE_SORTS = Object.freeze([
  { value:'recommended', label:'Рекомендуемые' },
  { value:'name-asc', label:'По названию: А–Я / A–Z' },
  { value:'name-desc', label:'По названию: Я–А / Z–A' }
])
export const STORE_SEARCH_MAX_LENGTH = 200
export const storeSort = value => STORE_SORTS.some(item => item.value === value) ? value : 'recommended'
export const storeSearch = value => typeof value === 'string' ? value.trim().slice(0, STORE_SEARCH_MAX_LENGTH) : ''

function safeWebsite(value) {
  if (typeof value !== 'string' || value.length > 2048 || !/^https?:\/\//iu.test(value) || /[\s\\]/u.test(value)) return false
  try {
    const url = new globalThis.URL(value)
    return Boolean(url.hostname && !url.username && !url.password)
  } catch { return false }
}

export function storeWebsiteLabel(value) {
  if (!safeWebsite(value)) return ''
  const url = new globalThis.URL(value)
  return `${url.host}${url.pathname === '/' ? '' : url.pathname}`
}

export function validatePublicStores(value, featured = false) {
  if (!value || !Array.isArray(value.items) || (featured && value.items.length > 6)) throw createInternalProblem('protocolError')
  const ids = new Set()
  for (const item of value.items) {
    if (!item || !Number.isInteger(item.id) || item.id < 1 || item.id > 2147483647 || ids.has(item.id)
      || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 200
      || typeof item.description !== 'string' || !item.description.trim() || item.description.length > 160
      || !safeWebsite(item.officialUrl)
      || typeof item.logoUrl !== 'string'
      || !new RegExp(`^/api/v1/stores/${item.id}/logo\\?v=[a-f0-9]{64}$`, 'u').test(item.logoUrl)) {
      throw createInternalProblem('protocolError')
    }
    ids.add(item.id)
  }
  return value.items.map(({ id, name, description, officialUrl, logoUrl }) => ({ id, name, description, officialUrl, logoUrl }))
}

export function createPublicStores(client = createApiClient({})) {
  const full = reactive({ items:null, loading:false, problem:null, sort:'recommended', search:'' })
  const featured = reactive({ items:null, loading:false, problem:null })
  const availability = reactive({ loading:false, problem:null })
  const available = ref(null)
  const pending = new Map()
  let generation = 0
  function request(path, isFeatured) {
    if (!pending.has(path)) {
      const operation = client.request(path).then(value => validatePublicStores(value, isFeatured))
        .finally(() => pending.delete(path))
      pending.set(path, operation)
    }
    return pending.get(path)
  }
  async function load(state, path, current, isFeatured = false, determinesAvailability = false) {
    state.loading = true
    state.problem = null
    try {
      const items = await request(path, isFeatured)
      if (current !== generation) return
      state.items = items
      if (determinesAvailability) available.value = items.length > 0
    } catch (value) {
      if (current !== generation) return
      state.problem = normalizeProblem(value)
      throw state.problem
    } finally {
      if (current === generation) state.loading = false
    }
  }
  async function loadAvailability(current) {
    availability.loading = true
    availability.problem = null
    try {
      const items = await request('/api/v1/stores?sort=recommended', false)
      if (current !== generation) return
      available.value = items.length > 0
    } catch (value) {
      if (current !== generation) return
      availability.problem = normalizeProblem(value)
      throw availability.problem
    } finally {
      if (current === generation) availability.loading = false
    }
  }
  function refresh(sort = 'recommended', search = '', includeFeatured = false) {
    const current = ++generation
    const normalized = storeSort(sort)
    const normalizedSearch = storeSearch(search)
    if (normalized !== full.sort || normalizedSearch !== full.search) full.items = null
    full.sort = normalized
    full.search = normalizedSearch
    featured.loading = false
    availability.loading = false
    if (!normalizedSearch) availability.problem = null
    const query = new globalThis.URLSearchParams({ sort:normalized })
    if (normalizedSearch) query.set('search', normalizedSearch)
    // Each resource owns its recoverable error; allSettled observes both failures.
    return Promise.allSettled([
      load(full, `/api/v1/stores?${query}`, current, false, !normalizedSearch),
      ...(normalizedSearch ? [loadAvailability(current)] : []),
      ...(includeFeatured ? [load(featured, '/api/v1/stores/featured', current, true)] : [])
    ])
  }
  function invalidate() { ++generation; full.loading = false; featured.loading = false; availability.loading = false }
  return { full, featured, availability, available, hasStores:computed(() => available.value === true), refresh, invalidate }
}

// Standalone views can render before the application shell provides its catalogue.
const fallback = createPublicStores()
export const usePublicStores = () => inject(PUBLIC_STORES, fallback)
