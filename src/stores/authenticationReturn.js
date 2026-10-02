// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { ref, shallowRef } from 'vue'
import { useProductDraft } from './productDraft.js'

const visit = shallowRef(null)
const resumeGeneration = ref(0)

function clear() {
  if (visit.value?.owner === 'product') useProductDraft().clearResume()
  visit.value = null
}
function save(value) { visit.value = value }
function resume() { resumeGeneration.value++ }
function observeRoute(path) {
  if (visit.value && path !== visit.value.originPath && path !== visit.value.documentPath) clear()
}
function isPending(owner) { return visit.value?.owner === owner }
function take(owner, path, customerId) {
  const value = visit.value
  if (!value || value.owner !== owner || value.originPath !== path) return null
  if (value.customerId !== customerId) { clear(); return null }
  visit.value = null
  return value.state
}

const authenticationReturn = { visit, resumeGeneration, clear, save, resume, observeRoute, isPending, take }
export function useAuthenticationReturn() { return authenticationReturn }
