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
import { SERVICE_UNAVAILABLE_MESSAGE, suppressProblem } from './errors/problem.js'
import { ACCESS } from './router.js'
import { useSession } from './stores/session.js'

const route = useRoute()
const router = useRouter()
const { customer, logout, restoreProblem, restoreSession, restoring } = useSession()
let sessionStarted = false
const authOpen = ref(false)

const customerRoute = computed(() => route.meta.access === ACCESS.CUSTOMER)
const consentRoute = computed(() => route.meta.access === ACCESS.LIMITED)
const restoreMessage = SERVICE_UNAVAILABLE_MESSAGE

async function startSession(force = false) {
  if (sessionStarted && !force) return
  sessionStarted = true
  await restoreSession()
}

function openAuthentication() {
  authOpen.value = true
}

async function signOut() {
  try { await logout() }
  catch (value) {
    suppressProblem(value, { detail: 'Не удалось завершить сеанс на сервере', operation: 'session.logout' })
  }
  await router.replace({ name: 'home' })
}

watch(
  [customerRoute, restoring, restoreProblem, customer],
  async ([requiresCustomer, loading, problem, currentCustomer]) => {
    if (requiresCustomer && !loading && !problem && !currentCustomer) {
      await router.replace({ name: 'home' })
    }
  },
  { immediate: true }
)

onMounted(async () => {
  await startSession()
})
</script>

<template>
  <v-app class="sarafan-app">
    <AppHeader
      :authenticated="Boolean(customer)"
      :authentication-available="true"
      @authenticate="openAuthentication"
      @logout="signOut"
    />

    <div class="app-content">
      <ConsentCenter
        v-if="!consentRoute"
        :notice-suppressed="restoring || Boolean(restoreProblem) || authOpen"
      />
      <div
        class="app-route-content"
      >
        <div
          v-if="restoreProblem && !authOpen && !customerRoute && !consentRoute"
          class="session-notice page-container"
        >
          <UiAlert>
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
            v-if="restoring"
            class="page-container route-gate"
            aria-label="Загрузка"
          >
            <span
              class="route-gate__spinner"
              aria-hidden="true"
            />
            <h1>Загрузка</h1>
          </main>
          <main
            v-else-if="restoreProblem"
            class="page-container route-gate"
          >
            <h1>{{ restoreMessage }}</h1>
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
          </main>
          <RouterView v-else-if="customer" />
        </template>
        <RouterView v-else />
      </div>
    </div>

    <SiteFooter :authenticated="Boolean(customer)" />

    <PhoneAuthDialog v-model="authOpen" />
  </v-app>
</template>
