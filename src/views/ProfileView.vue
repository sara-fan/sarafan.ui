<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import { LEGAL_DOCUMENT_KIND } from '../consentFormatting.js'
import {
  createInternalProblem,
  normalizeProblem,
  presentProblem,
  problemFieldErrors,
  suppressProblem
} from '../errors/problem.js'
import { useConsents } from '../stores/consents.js'
import { useSession } from '../stores/session.js'
import UiAlert from '../components/ui/UiAlert.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiField from '../components/ui/UiField.vue'

const router = useRouter()
const { customer, deletePhoto, getPhoto, logout, updateProfile, uploadPhoto } = useSession()
const consents = useConsents()
const fields = [
  'lastName', 'firstName', 'patronymic', 'email', 'passportSeries', 'passportNumber',
  'passportIssueDate', 'passportIssuedBy', 'inn', 'postalCode', 'city', 'address'
]
const form = reactive(Object.fromEntries(fields.map(field => [field, ''])))
const editing = ref(false)
const busy = ref(false)
const problem = ref(null)
const saved = ref(false)
const photoUrl = ref('')
let photoLoadVersion = 0

const profile = computed(() => customer.value?.profile || {})
const error = computed(() => problem.value ? presentProblem(problem.value) : '')
const initials = computed(() => {
  const value = `${profile.value.firstName?.[0] || ''}${profile.value.lastName?.[0] || ''}`.trim()
  return value || 'С'
})
const deliveryAddress = computed(() => [profile.value.city, profile.value.address].filter(Boolean).join(', ') || '—')
const privacyAlias = computed(() => consents.ops.value?.kinds
  .find(item => item.value === LEGAL_DOCUMENT_KIND.PRIVACY_POLICY)?.routeAlias || '')

function releasePhoto() {
  photoLoadVersion += 1
  if (photoUrl.value) globalThis.URL.revokeObjectURL(photoUrl.value)
  photoUrl.value = ''
}

function fillForm() {
  for (const field of fields) form[field] = profile.value[field] ?? ''
}

function fieldErrors(field) { return problemFieldErrors(problem.value, field) }
function display(field) { return profile.value[field] || '—' }
function captureProblem(value, detail) { problem.value = normalizeProblem(value, { detail }) }

async function loadPhoto() {
  releasePhoto()
  const loadVersion = photoLoadVersion
  if (!customer.value?.hasPhoto) return
  try {
    const photo = await getPhoto()
    if (loadVersion !== photoLoadVersion) return
    photoUrl.value = globalThis.URL.createObjectURL(photo)
  } catch (value) {
    if (loadVersion === photoLoadVersion) problem.value = createInternalProblem('photoPreviewUnavailable', { cause: value })
  }
}

function startEditing() {
  fillForm()
  problem.value = null
  saved.value = false
  editing.value = true
}

function cancelEditing() {
  fillForm()
  problem.value = null
  editing.value = false
}

async function save() {
  busy.value = true
  problem.value = null
  saved.value = false
  try {
    await consents.requirePersonalData()
    await updateProfile(Object.fromEntries(fields.map(field => [field, form[field] || null])))
    saved.value = true
    editing.value = false
  } catch (value) {
    captureProblem(value, 'Не удалось сохранить профиль')
  } finally {
    busy.value = false
  }
}

async function selectPhoto(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    problem.value = createInternalProblem('invalidInput', {
      detail: 'Выберите JPEG, PNG или WebP размером не более 5 МБ',
      errors: { photo: ['Выберите JPEG, PNG или WebP размером не более 5 МБ'] }
    })
    return
  }
  busy.value = true
  problem.value = null
  try {
    await consents.requirePersonalData()
    await uploadPhoto(file)
    await loadPhoto()
  } catch (value) {
    captureProblem(value, 'Не удалось загрузить фотографию')
  } finally {
    busy.value = false
  }
}

async function removePhoto() {
  busy.value = true
  problem.value = null
  try {
    await deletePhoto()
    releasePhoto()
  } catch (value) {
    captureProblem(value, 'Не удалось удалить фотографию')
  } finally {
    busy.value = false
  }
}

async function signOut() {
  try { await logout() }
  catch (value) {
    suppressProblem(value, { detail: 'Не удалось завершить сеанс на сервере', operation: 'session.logout' })
  }
  await router.replace({ name: 'home' })
}

watch(() => customer.value?.id, async () => {
  fillForm()
  problem.value = null
  editing.value = false
  await loadPhoto()
}, { immediate: true })

onBeforeUnmount(releasePhoto)
</script>

<template>
  <main class="page-container profile-view">
    <header class="page-heading profile-heading">
      <div>
        <p class="page-kicker">
          ЛИЧНЫЙ КАБИНЕТ
        </p>
        <h1>Профиль</h1>
        <p>Здесь хранятся данные, которые мы подставим при следующем заказе.</p>
      </div>
      <UiButton
        v-if="!editing"
        variant="secondary"
        @click="startEditing"
      >
        Редактировать
      </UiButton>
    </header>

    <UiAlert
      v-if="error"
      :title="problem?.title"
    >
      {{ error }}
    </UiAlert>
    <UiAlert
      v-else-if="saved"
      tone="success"
    >
      Профиль сохранён
    </UiAlert>

    <form
      v-if="editing"
      class="profile-layout"
      @submit.prevent="save"
    >
      <section class="profile-section">
        <h2>Аккаунт</h2>
        <div class="profile-account">
          <span class="profile-avatar">
            <img
              v-if="photoUrl"
              :src="photoUrl"
              alt="Фотография профиля"
            >
            <span v-else>{{ initials }}</span>
          </span>
          <div class="profile-photo-actions">
            <strong>{{ customer?.phone || 'Телефон не указан' }}</strong>
            <small>Телефон аккаунта подтверждён и не редактируется.</small>
            <label class="photo-action">
              {{ customer?.hasPhoto ? 'Заменить фото' : 'Загрузить фото' }}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                :disabled="busy"
                @change="selectPhoto"
              >
            </label>
            <button
              v-if="customer?.hasPhoto"
              class="photo-remove"
              type="button"
              :disabled="busy"
              @click="removePhoto"
            >
              Удалить
            </button>
          </div>
        </div>
        <UiField
          v-model="form.email"
          label="Электронная почта"
          type="email"
          maxlength="254"
          :errors="fieldErrors('email')"
        />
      </section>

      <section class="profile-section">
        <h2>Получатель</h2>
        <div class="profile-form-grid">
          <UiField
            v-model="form.firstName"
            label="Имя"
            maxlength="100"
            :errors="fieldErrors('firstName')"
          />
          <UiField
            v-model="form.lastName"
            label="Фамилия"
            maxlength="100"
            :errors="fieldErrors('lastName')"
          />
          <UiField
            v-model="form.patronymic"
            label="Отчество"
            maxlength="100"
            :errors="fieldErrors('patronymic')"
          />
        </div>
      </section>

      <section class="profile-section">
        <div class="profile-section__heading">
          <h2>Паспортные данные</h2><p>Нужны для таможенного оформления</p>
        </div>
        <div class="profile-form-grid">
          <UiField
            v-model="form.inn"
            label="ИНН"
            inputmode="numeric"
            maxlength="12"
            :errors="fieldErrors('inn')"
          />
          <UiField
            v-model="form.passportSeries"
            label="Серия паспорта"
            maxlength="32"
            :errors="fieldErrors('passportSeries')"
          />
          <UiField
            v-model="form.passportNumber"
            label="Номер паспорта"
            maxlength="32"
            :errors="fieldErrors('passportNumber')"
          />
          <UiField
            v-model="form.passportIssueDate"
            label="Дата выдачи"
            type="date"
            :errors="fieldErrors('passportIssueDate')"
          />
          <UiField
            v-model="form.passportIssuedBy"
            class="profile-form-grid__wide"
            label="Кем выдан"
            multiline
            maxlength="500"
            :errors="fieldErrors('passportIssuedBy')"
          />
        </div>
      </section>

      <section class="profile-section">
        <h2>Доставка</h2>
        <div class="profile-form-grid">
          <UiField
            v-model="form.city"
            label="Город"
            maxlength="150"
            :errors="fieldErrors('city')"
          />
          <UiField
            v-model="form.postalCode"
            label="Индекс"
            maxlength="20"
            :errors="fieldErrors('postalCode')"
          />
          <UiField
            v-model="form.address"
            class="profile-form-grid__wide"
            label="Последний адрес"
            multiline
            maxlength="500"
            :errors="fieldErrors('address')"
          />
        </div>
      </section>

      <div class="profile-form-actions">
        <UiButton
          variant="secondary"
          :disabled="busy"
          @click="cancelEditing"
        >
          Отмена
        </UiButton>
        <UiButton
          type="submit"
          variant="primary"
          :loading="busy"
        >
          Сохранить
        </UiButton>
      </div>
    </form>

    <div
      v-else
      class="profile-layout"
    >
      <section class="profile-section">
        <h2>Аккаунт</h2>
        <div class="profile-account">
          <span class="profile-avatar">
            <img
              v-if="photoUrl"
              :src="photoUrl"
              alt="Фотография профиля"
            >
            <span v-else>{{ initials }}</span>
          </span>
          <div><strong>{{ customer?.phone || '—' }}</strong><p>{{ display('email') }}</p></div>
        </div>
      </section>

      <section class="profile-section">
        <h2>Получатель</h2>
        <dl class="profile-data-grid">
          <div><dt>Имя</dt><dd>{{ display('firstName') }}</dd></div>
          <div><dt>Фамилия</dt><dd>{{ display('lastName') }}</dd></div>
          <div><dt>Отчество</dt><dd>{{ display('patronymic') }}</dd></div>
        </dl>
      </section>

      <section class="profile-section">
        <div class="profile-section__heading">
          <h2>Паспортные данные</h2><p>Нужны для таможенного оформления</p>
        </div>
        <dl class="profile-data-grid">
          <div><dt>ИНН</dt><dd>{{ display('inn') }}</dd></div>
          <div><dt>Серия паспорта</dt><dd>{{ display('passportSeries') }}</dd></div>
          <div><dt>Номер паспорта</dt><dd>{{ display('passportNumber') }}</dd></div>
          <div><dt>Дата выдачи</dt><dd>{{ display('passportIssueDate') }}</dd></div>
          <div><dt>Кем выдан</dt><dd>{{ display('passportIssuedBy') }}</dd></div>
        </dl>
      </section>

      <section class="profile-section">
        <h2>Доставка</h2>
        <dl class="profile-data-grid">
          <div><dt>Последний адрес</dt><dd>{{ deliveryAddress }}</dd></div>
          <div><dt>Индекс</dt><dd>{{ display('postalCode') }}</dd></div>
        </dl>
      </section>
    </div>

    <nav
      class="profile-privacy"
      aria-label="Профиль и конфиденциальность"
    >
      <RouterLink
        v-if="privacyAlias"
        :to="{ name: 'legal-document', params: { documentRef: privacyAlias } }"
      >
        Политика обработки данных
      </RouterLink>
      <RouterLink :to="{ name: 'consents' }">
        Мои согласия и обращения
      </RouterLink>
    </nav>
    <UiButton
      variant="quiet"
      class="profile-logout"
      @click="signOut"
    >
      Выйти
    </UiButton>
  </main>
</template>
