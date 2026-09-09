<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, onMounted, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'

import AppHeader from './components/AppHeader.vue'
import ConsentCenter from './components/ConsentCenter.vue'
import PhoneAuthDialog from './components/PhoneAuthDialog.vue'
import SiteFooter from './components/SiteFooter.vue'
import UiAlert from './components/ui/UiAlert.vue'
import UiButton from './components/ui/UiButton.vue'
import { presentProblem, suppressProblem } from './errors/problem.js'
import { ACCESS } from './router.js'
import { useConsents } from './stores/consents.js'
import { useSession } from './stores/session.js'

const route = useRoute()
const router = useRouter()
const consentStore = useConsents()
const { customer, logout, restoreProblem, restoreSession, restoring } = useSession()
const { serviceAllowed } = consentStore
let sessionStarted = false
const authOpen = ref(false)

const customerRoute = computed(() => route.meta.access === ACCESS.CUSTOMER)
const restoreMessage = computed(() => restoreProblem.value ? presentProblem(restoreProblem.value) : '')

async function startSession(force = false) {
  if (!serviceAllowed.value || (sessionStarted && !force)) return
  sessionStarted = true
  await restoreSession()
}

function openAuthentication() {
  if (serviceAllowed.value) authOpen.value = true
}

async function signOut() {
  try { await logout() }
  catch (value) {
    suppressProblem(value, { detail: 'Не удалось завершить сеанс на сервере', operation: 'session.logout' })
  }
  await router.replace({ name: 'home' })
}

watch(serviceAllowed, allowed => {
  if (allowed) startSession()
})

watch(
  [customerRoute, serviceAllowed, restoring, restoreProblem, customer],
  async ([requiresCustomer, allowed, loading, problem, currentCustomer]) => {
    if (requiresCustomer && allowed && !loading && !problem && !currentCustomer) {
      await router.replace({ name: 'home' })
    }
  },
  { immediate: true }
)

onMounted(async () => {
  try { await consentStore.loadCookies() }
  catch { /* ConsentCenter owns the recoverable presentation. */ }
  await startSession()
})
</script>

<template>
  <v-app class="sarafan-app">
    <AppHeader
      :authenticated="Boolean(customer)"
      :authentication-available="serviceAllowed"
      @authenticate="openAuthentication"
      @logout="signOut"
    />

    <div class="app-content">
      <div
        v-if="restoreProblem && !customerRoute"
        class="session-notice page-container"
      >
        <UiAlert :title="restoreProblem.title">
          <p>{{ restoreMessage }}</p>
          <UiButton
            variant="secondary"
            @click="startSession(true)"
          >
            Повторить
          </UiButton>
        </UiAlert>
      </div>

      <template v-if="customerRoute">
        <main
          v-if="!serviceAllowed"
          class="page-container route-gate"
        >
          <p class="page-kicker">
            ТРЕБУЕТСЯ СОГЛАСИЕ
          </p>
          <h1>Настройте обязательные куки</h1>
          <p>После подтверждения мы безопасно восстановим сессию и откроем этот раздел.</p>
        </main>
        <main
          v-else-if="restoring"
          class="page-container route-gate"
          aria-label="Восстановление сессии"
        >
          <span
            class="route-gate__spinner"
            aria-hidden="true"
          />
          <h1>Восстанавливаем сессию</h1>
        </main>
        <main
          v-else-if="restoreProblem"
          class="page-container route-gate"
        >
          <p class="page-kicker">
            СЕССИЯ
          </p>
          <h1>Не удалось открыть раздел</h1>
          <UiAlert :title="restoreProblem.title">
            <p>{{ restoreMessage }}</p>
            <div class="route-gate__actions">
              <UiButton
                variant="primary"
                @click="startSession(true)"
              >
                Повторить
              </UiButton>
              <UiButton
                variant="secondary"
                @click="router.push({ name: 'home' })"
              >
                На главную
              </UiButton>
            </div>
          </UiAlert>
        </main>
        <RouterView v-else-if="customer" />
      </template>
      <RouterView v-else />
    </div>

    <SiteFooter />

    <PhoneAuthDialog v-model="authOpen" />
    <ConsentCenter />
  </v-app>
</template>
