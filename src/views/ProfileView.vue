<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'

import {
  createInternalProblem,
  normalizeProblem,
  presentProblem,
  problemFieldErrors
} from '../errors/problem.js'
import { useConsents } from '../stores/consents.js'
import { useSession } from '../stores/session.js'
import UiAlert from '../components/ui/UiAlert.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiField from '../components/ui/UiField.vue'

const { customer, deletePhoto, getPhoto, updateProfile, uploadPhoto } = useSession()
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
const photoInput = ref(null)
let photoLoadVersion = 0

const profile = computed(() => customer.value?.profile || {})
const error = computed(() => problem.value ? presentProblem(problem.value) : '')
const initials = computed(() => {
  const value = `${profile.value.firstName?.[0] || ''}${profile.value.lastName?.[0] || ''}`.trim()
  return value || 'С'
})
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
function openPhotoPicker() { photoInput.value?.click() }

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
        <h1>Профиль</h1>
        <p>Здесь хранятся данные, которые мы подставим при следующем заказе.</p>
      </div>
      <UiButton
        v-if="!editing"
        variant="primary"
        @click="startEditing"
      >
        Редактировать
      </UiButton>
      <div
        v-else
        class="profile-heading__actions"
      >
        <UiButton
          variant="secondary"
          :disabled="busy"
          @click="cancelEditing"
        >
          Отмена
        </UiButton>
        <UiButton
          type="submit"
          form="profile-edit-form"
          variant="primary"
          :loading="busy"
        >
          Сохранить
        </UiButton>
      </div>
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

    <component
      :is="editing ? 'form' : 'div'"
      :id="editing ? 'profile-edit-form' : undefined"
      class="profile-layout"
      @submit.prevent="save"
    >
      <section
        class="profile-account-panel"
        aria-labelledby="profile-account-title"
      >
        <h2 id="profile-account-title">
          Аккаунт
        </h2>
        <div class="profile-account-panel__summary">
          <span class="profile-avatar">
            <img
              v-if="photoUrl"
              :src="photoUrl"
              alt="Фотография профиля"
            >
            <span v-else>{{ initials }}</span>
          </span>
          <div class="profile-account-panel__identity">
            <strong>{{ customer?.phone || 'Телефон не указан' }}</strong>
            <small>Телефон подтверждён</small>
          </div>
        </div>
        <p
          v-if="!editing"
          class="profile-account-panel__email-value"
        >
          <span>Электронная почта</span>
          <strong>{{ display('email') }}</strong>
        </p>
        <UiField
          v-if="editing"
          v-model="form.email"
          class="profile-account-panel__email"
          label="Электронная почта"
          type="email"
          maxlength="254"
          :errors="fieldErrors('email')"
        />
        <div
          v-if="editing"
          class="profile-photo-actions"
        >
          <UiButton
            v-if="customer?.hasPhoto"
            class="photo-remove"
            variant="danger"
            :disabled="busy"
            @click="removePhoto"
          >
            Удалить
          </UiButton>
          <UiButton
            variant="primary"
            :disabled="busy"
            @click="openPhotoPicker"
          >
            {{ customer?.hasPhoto ? 'Заменить фото' : 'Загрузить фото' }}
          </UiButton>
          <input
            ref="photoInput"
            class="profile-photo-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            :disabled="busy"
            @change="selectPhoto"
          >
        </div>
      </section>

      <div class="profile-details">
        <section class="profile-details__section">
          <h2>Получатель</h2>
          <div
            v-if="editing"
            class="profile-form-grid profile-form-grid--recipient"
          >
            <UiField
              v-model="form.firstName"
              label="Имя"
              maxlength="100"
              :errors="fieldErrors('firstName')"
            />
            <UiField
              v-model="form.patronymic"
              label="Отчество"
              maxlength="100"
              :errors="fieldErrors('patronymic')"
            />
            <UiField
              v-model="form.lastName"
              label="Фамилия"
              maxlength="100"
              :errors="fieldErrors('lastName')"
            />
          </div>
          <dl
            v-else
            class="profile-data-grid profile-data-grid--recipient"
          >
            <div><dt>Имя</dt><dd>{{ display('firstName') }}</dd></div>
            <div><dt>Отчество</dt><dd>{{ display('patronymic') }}</dd></div>
            <div><dt>Фамилия</dt><dd>{{ display('lastName') }}</dd></div>
          </dl>
        </section>

        <section class="profile-details__section">
          <div class="profile-details__heading">
            <h2>Паспортные данные</h2>
            <p>Нужны для таможенного оформления</p>
          </div>
          <div
            v-if="editing"
            class="profile-form-grid"
          >
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
            <div class="profile-grid__wide">
              <UiField
                v-model="form.passportIssuedBy"
                label="Кем выдан"
                multiline
                :rows="2"
                maxlength="500"
                :errors="fieldErrors('passportIssuedBy')"
              />
            </div>
          </div>
          <dl
            v-else
            class="profile-data-grid"
          >
            <div><dt>ИНН</dt><dd>{{ display('inn') }}</dd></div>
            <div><dt>Серия паспорта</dt><dd>{{ display('passportSeries') }}</dd></div>
            <div><dt>Номер паспорта</dt><dd>{{ display('passportNumber') }}</dd></div>
            <div><dt>Дата выдачи</dt><dd>{{ display('passportIssueDate') }}</dd></div>
            <div class="profile-grid__wide">
              <dt>Кем выдан</dt><dd>{{ display('passportIssuedBy') }}</dd>
            </div>
          </dl>
        </section>

        <section class="profile-details__section">
          <h2>Доставка</h2>
          <div
            v-if="editing"
            class="profile-form-grid"
          >
            <UiField
              v-model="form.postalCode"
              label="Индекс"
              maxlength="20"
              :errors="fieldErrors('postalCode')"
            />
            <UiField
              v-model="form.city"
              label="Регион, населённый пункт"
              maxlength="150"
              :errors="fieldErrors('city')"
            />
            <div class="profile-grid__wide">
              <UiField
                v-model="form.address"
                label="Адрес"
                multiline
                :rows="2"
                maxlength="500"
                :errors="fieldErrors('address')"
              />
            </div>
          </div>
          <dl
            v-else
            class="profile-data-grid"
          >
            <div><dt>Индекс</dt><dd>{{ display('postalCode') }}</dd></div>
            <div><dt>Регион, населённый пункт</dt><dd>{{ display('city') }}</dd></div>
            <div class="profile-grid__wide">
              <dt>Адрес</dt><dd>{{ display('address') }}</dd>
            </div>
          </dl>
        </section>
      </div>
    </component>
  </main>
</template>
