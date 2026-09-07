<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useSession } from '../stores/session.js'
import { useConsents } from '../stores/consents.js'
import { LEGAL_DOCUMENT_KIND, CONSENT_STATUSES, downloadBytes, moscowTime } from '../consentFormatting.js'
import { normalizeProblem, presentProblem, createInternalProblem } from '../errors/problem.js'
import LegalDocumentReader from './LegalDocumentReader.vue'

const session = useSession()
const store = useConsents()
const { cookies, mine, ops, opsProblem, cookieProblem, personalProblem } = store
const cookieOpen = ref(false)
const personalOpen = ref(false)
const documentOpen = ref(false)
const document = ref(null)
const cookieDocument = ref(null)
const personalDocument = ref(null)
const categories = ref([])
const accepted = ref(false)
const problem = ref(null)
const busy = ref(false)
let documentEpoch = 0
let choiceKey = globalThis.crypto.randomUUID()
let choiceSignature = ''
let personalKey = globalThis.crypto.randomUUID()
let personalSignature = ''
const status = computed(() => mine.value?.statuses.find(x => x.kind === LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT))
const withdrawalPending = computed(() => mine.value?.withdrawalRequest?.processed === false)
const cookieRequired = computed(() => !store.serviceAllowed.value)
const canGrantCookies = computed(() => store.requiredCookieCategories().every(category => categories.value.includes(category)))
const message = computed(() => problem.value ? presentProblem(problem.value) : '')
const label = value => CONSENT_STATUSES[value] || value
function resetChoice() { choiceKey = globalThis.crypto.randomUUID(); choiceSignature = '' }

async function perform(action, onVersionChanged) {
  busy.value = true
  problem.value = null
  try { await action() }
  catch (error) {
    problem.value = normalizeProblem(error)
    if (problem.value.type === 'https://sarafan.sw.consulting/problems/consent-version-changed' && onVersionChanged) {
      try { await onVersionChanged() }
      catch (refreshError) { problem.value = normalizeProblem(refreshError) }
    }
  }
  finally { busy.value = false }
}
async function openLegal() {
  if (globalThis.location.hash === '#consents' && session.customer.value) { await openPersonal(); return }
  const target = globalThis.location.hash.slice(7)
  if (!globalThis.location.hash.startsWith('#legal/')) return
  const epoch = ++documentEpoch
  documentOpen.value = true
  document.value = null
  await perform(async () => {
    await store.ensureOps()
    const kind = store.kindByAlias(target)
    const result = kind !== undefined ? (await store.current(kind)).document : await store.read(target)
    if (!result) throw createInternalProblem('invalidInput', { detail:'Документ пока не действует.' })
    if (epoch === documentEpoch) document.value = result
  })
}
function closeLegal() {
  documentEpoch++
  documentOpen.value = false
  globalThis.history.replaceState(null, '', globalThis.location.pathname + globalThis.location.search)
}
async function download(value) { await perform(async () => downloadBytes(await store.source(value.id), value.id)) }
async function openCookies() {
  cookieOpen.value = true
  cookieDocument.value = null
  categories.value = [...(cookies.value?.categories || [])]
  resetChoice()
  await perform(async () => {
    await store.loadCookies()
    categories.value = [...(cookies.value?.categories || [])]
    cookieDocument.value = (await store.current(LEGAL_DOCUMENT_KIND.COOKIE_CONSENT)).document
    if (!cookieDocument.value) throw createInternalProblem('invalidInput', { detail:'Документ о куки пока не действует. Использование сервиса недоступно.' })
  })
}
async function chooseCookies(decision) {
  await perform(async () => {
    let text = cookieDocument.value
    if (decision === 'withdraw' && cookies.value?.documentId) text = await store.read(cookies.value.documentId)
    if (!text) return
    const selected = decision === 'grant' ? categories.value : []
    const signature = JSON.stringify([text.id, text.contentHash, decision, [...selected].sort()])
    if (choiceSignature !== signature) resetChoice()
    choiceSignature = signature
    await store.decideCookies(text, decision, selected, choiceKey)
    resetChoice()
    cookieOpen.value = false
  }, async () => {
    categories.value = []
    cookieDocument.value = null
    resetChoice()
    cookieDocument.value = (await store.current(LEGAL_DOCUMENT_KIND.COOKIE_CONSENT)).document
  })
}
async function openPersonal() {
  personalOpen.value = true
  accepted.value = false
  personalDocument.value = null
  await perform(async () => {
    await store.loadMine()
    personalDocument.value = (await store.current(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)).document
  })
}
function closePersonal() {
  personalOpen.value = false
  if (globalThis.location.hash === '#consents') globalThis.history.replaceState(null, '', globalThis.location.pathname + globalThis.location.search)
}
async function grant() {
  if (!accepted.value || !personalDocument.value) return
  await perform(async () => {
    const signature = JSON.stringify([session.customer.value.id, personalDocument.value.id, personalDocument.value.contentHash])
    if (personalSignature !== signature) personalKey = globalThis.crypto.randomUUID()
    personalSignature = signature
    await store.grant(personalDocument.value, personalKey)
    personalSignature = ''
    accepted.value = false
  }, async () => {
    accepted.value = false
    personalDocument.value = null
    await store.loadMine()
    personalDocument.value = (await store.current(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)).document
  })
}
async function requestWithdrawal() { await perform(() => store.requestWithdrawal()) }
async function refreshOps() {
  await perform(() => store.loadOps())
}
function visible() {
  if (globalThis.document.visibilityState === 'visible') perform(() => Promise.all([store.loadCookies(), store.loadMine()]))
}
watch(() => session.customer.value?.id, async (id, _previous, cleanup) => {
  let active = true
  cleanup(() => { active = false })
  store.resetCustomer()
  personalOpen.value = false
  personalDocument.value = null
  if (!id) return
  try {
    if (store.serviceAllowed.value) await store.associate()
    if (active) await store.loadMine()
  }
  catch (error) { if (active) problem.value = normalizeProblem(error) }
}, { immediate:true })
onMounted(() => {
  if (globalThis.location.hash === '#consents' || globalThis.location.hash.startsWith('#legal/')) openLegal()
  else refreshOps()
  globalThis.addEventListener('hashchange', openLegal)
  globalThis.addEventListener('focus', visible)
  globalThis.document.addEventListener('visibilitychange', visible)
})
onUnmounted(() => {
  documentEpoch++
  globalThis.removeEventListener('hashchange', openLegal)
  globalThis.removeEventListener('focus', visible)
  globalThis.document.removeEventListener('visibilitychange', visible)
  store.dispose()
})
</script>
<template>
  <footer
    class="consent-footer"
    aria-label="Документы и согласия"
  >
    <a
      v-for="item in ops?.kinds || []"
      :key="item.value"
      :href="`#legal/${item.routeAlias}`"
    >{{ item.name }}</a>
    <span
      v-if="opsProblem"
      role="alert"
    >{{ presentProblem(opsProblem) }} <button
      type="button"
      @click="refreshOps"
    >Повторить загрузку документов</button></span>
    <button
      type="button"
      @click="openCookies"
    >
      Настройки куки
    </button>
    <button
      v-if="session.customer.value"
      type="button"
      @click="openPersonal"
    >
      Мои согласия и обращения
    </button>
    <p
      v-if="session.customer.value && status?.status !== 'current'"
      role="status"
    >
      Для сохранения персональных данных требуется актуальное согласие. Документы, история, отзыв и выход доступны.
    </p>
    <p
      v-if="personalProblem && !personalOpen"
      role="alert"
    >
      {{ presentProblem(personalProblem) }}
    </p>
  </footer>
  <section
    v-if="cookieRequired && !cookieOpen"
    class="cookie-notice"
    aria-label="Использование куки"
  >
    <strong>Согласие на куки</strong>
    <p>Для использования сервиса необходимо принять обязательные куки.</p>
    <p
      v-if="cookieProblem"
      role="alert"
    >
      {{ presentProblem(cookieProblem) }}
    </p>
    <v-btn @click="openCookies">
      Настроить куки
    </v-btn>
  </section>
  <v-dialog
    v-model="cookieOpen"
    max-width="850"
    scrollable
  >
    <v-card
      class="consent-panel"
      title="Настройки куки"
    >
      <v-card-text>
        <p
          v-if="message"
          role="alert"
        >
          {{ message }}
        </p>
        <p>Отметьте обязательную категорию и подтвердите согласие, чтобы использовать сервис.</p>
        <LegalDocumentReader
          v-if="cookieDocument"
          :document="cookieDocument"
          @download="download(cookieDocument)"
        />
        <v-checkbox
          v-for="category in cookieDocument?.cookieCategories || []"
          :key="category"
          v-model="categories"
          :value="category"
          :label="store.cookieCategoryName(category)"
          :disabled="busy"
          @update:model-value="resetChoice"
        />
        <p v-if="cookies">
          Состояние: {{ label(cookies.status) }}. Выбор относится к этому браузеру.
        </p>
      </v-card-text>
      <v-card-actions class="consent-actions">
        <v-btn
          :disabled="busy || !cookieDocument"
          @click="chooseCookies('refuse')"
        >
          Отказаться
        </v-btn>
        <v-btn
          :disabled="busy || !cookieDocument || !canGrantCookies"
          @click="chooseCookies('grant')"
        >
          Принять обязательные куки
        </v-btn>
        <v-btn
          v-if="cookies?.documentId"
          :disabled="busy"
          @click="chooseCookies('withdraw')"
        >
          Отозвать согласие на куки
        </v-btn>
        <v-btn
          :disabled="busy"
          @click="openCookies"
        >
          Обновить документ
        </v-btn>
        <v-btn @click="cookieOpen = false">
          Закрыть
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  <v-dialog
    :model-value="personalOpen"
    max-width="900"
    scrollable
    @update:model-value="!$event && closePersonal()"
  >
    <v-card
      class="consent-panel"
      title="Мои согласия и обращения"
    >
      <v-card-text>
        <p
          v-if="message"
          role="alert"
        >
          {{ message }}
        </p>
        <p>Персональные данные: {{ label(status?.status || 'unavailable') }}</p>
        <LegalDocumentReader
          v-if="personalDocument"
          :document="personalDocument"
          @download="download(personalDocument)"
        />
        <v-checkbox
          v-if="status?.status !== 'current' && personalDocument"
          v-model="accepted"
          label="Я даю отдельное согласие на хранение и обработку персональных данных по этому документу"
          :disabled="busy"
        />
        <v-btn
          v-if="status?.status !== 'current'"
          :disabled="busy || !accepted"
          @click="grant"
        >
          Дать согласие
        </v-btn>
        <p>Запрос будет записан для ручной обработки сотрудниками. Его отправка сама по себе не отключает учётную запись, не удаляет данные и не изменяет состояние согласия.</p>
        <v-btn
          :disabled="busy || withdrawalPending"
          @click="requestWithdrawal"
        >
          Прекратить использовать систему и отозвать согласие на обработку персональных данных
        </v-btn>
        <p
          v-if="mine?.withdrawalRequest"
          class="withdrawal-record"
        >
          Запрос от {{ moscowTime(mine.withdrawalRequest.requestedAt) }} ·
          {{ mine.withdrawalRequest.processed ? 'Обработан' : 'Ожидает ручной обработки' }}
        </p>
        <h3>История</h3>
        <p>Записи куки связаны с аккаунтом в момент наблюдения. Они не разрешают куки на других устройствах.</p>
        <ol class="consent-history">
          <li
            v-for="event in mine?.history || []"
            :key="event.id"
          >
            {{ store.kindName(event.kind) }} · {{ label(event.decision) }} · {{ moscowTime(event.at) }}
            <a
              :href="`#legal/${event.documentId}`"
            >Версия {{ event.displayVersion }}</a>
            <small v-if="event.associatedAt">Связано с аккаунтом {{ moscowTime(event.associatedAt) }}</small>
          </li>
        </ol>
      </v-card-text>
      <v-card-actions>
        <v-btn
          :disabled="busy"
          @click="openPersonal"
        >
          Обновить
        </v-btn><v-btn @click="closePersonal">
          Закрыть
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  <v-dialog
    :model-value="documentOpen"
    max-width="950"
    scrollable
    @update:model-value="!$event && closeLegal()"
  >
    <v-card
      class="consent-panel"
      title="Документ"
    >
      <v-card-text>
        <p
          v-if="message"
          role="alert"
        >
          {{ message }}
        </p><LegalDocumentReader
          v-if="document"
          :document="document"
          @download="download(document)"
        />
      </v-card-text>
      <v-card-actions>
        <v-btn @click="openLegal">
          Повторить
        </v-btn><v-btn @click="closeLegal">
          Закрыть
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
<style scoped>
.consent-footer { padding:1rem 1.5rem 6rem; display:flex; gap:.8rem 1.2rem; flex-wrap:wrap; background:#f4f8fc; }
.consent-footer a, .consent-footer button { color:#1565c0; text-decoration:underline; }
.consent-footer p { flex-basis:100%; }
.cookie-notice { position:fixed; z-index:1100; bottom:1rem; left:1rem; right:1rem; max-width:44rem; padding:1rem; border:1px solid #1976d2; border-radius:8px; background:white; box-shadow:0 4px 24px #17345633; }
.consent-actions { flex-wrap:wrap; }
.consent-panel :deep(.v-btn) { max-width:100%; height:auto; min-height:2.5rem; }
.consent-panel :deep(.v-btn__content) { white-space:normal; padding:.3rem 0; }
.consent-history { padding-left:1.4rem; }
.consent-history li, .withdrawal-record { padding:.6rem 0; border-bottom:1px solid #ccd9e8; }
.consent-history small { display:block; }
@media print { .consent-footer, .cookie-notice { display:none; } }
</style>
