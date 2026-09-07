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
import { useSession } from '../stores/session.js'
import { useConsents } from '../stores/consents.js'

const props = defineProps({
  modelValue: { type: Boolean, required: true }
})
const emit = defineEmits(['update:modelValue'])
const { customer, deletePhoto, getPhoto, updateProfile, uploadPhoto } = useSession()
const consents = useConsents()

const fields = [
  'lastName', 'firstName', 'patronymic', 'email', 'passportSeries', 'passportNumber',
  'passportIssueDate', 'passportIssuedBy', 'inn', 'postalCode', 'city', 'address'
]
const form = reactive(Object.fromEntries(fields.map((field) => [field, ''])))
const busy = ref(false)
const problem = ref(null)
const error = computed(() => problem.value ? presentProblem(problem.value) : '')
const saved = ref(false)
const photoUrl = ref('')
let photoLoadVersion = 0

function releasePhoto() {
  photoLoadVersion += 1
  if (photoUrl.value) globalThis.URL.revokeObjectURL(photoUrl.value)
  photoUrl.value = ''
}

function fillForm() {
  for (const field of fields) form[field] = customer.value?.profile?.[field] ?? ''
}

function fieldErrors(field) {
  return problemFieldErrors(problem.value, field)
}

function captureProblem(value, detail) {
  problem.value = normalizeProblem(value, { detail })
}

async function loadPhoto() {
  releasePhoto()
  const loadVersion = photoLoadVersion
  if (!props.modelValue || !customer.value?.hasPhoto) return
  try {
    const photo = await getPhoto()
    if (loadVersion !== photoLoadVersion || !props.modelValue) return
    photoUrl.value = globalThis.URL.createObjectURL(photo)
  } catch (value) {
    if (loadVersion === photoLoadVersion && props.modelValue) {
      problem.value = createInternalProblem('photoPreviewUnavailable', { cause: value })
    }
  }
}

watch(() => props.modelValue, async (open) => {
  if (!open) {
    releasePhoto()
    return
  }
  problem.value = null
  saved.value = false
  fillForm()
  await loadPhoto()
})

async function save() {
  busy.value = true
  problem.value = null
  saved.value = false
  try {
    await consents.requirePersonalData()
    await updateProfile(Object.fromEntries(
      fields.map((field) => [field, form[field] || null])
    ))
    saved.value = true
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

onBeforeUnmount(releasePhoto)
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="820"
    persistent
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card class="profile-dialog">
      <form @submit.prevent="save">
        <div class="profile-dialog__header">
          <div>
            <span class="section-kicker">Данные получателя</span>
            <h2>Мой профиль</h2>
            <p><a href="#legal/privacy-policy">Политика обработки данных</a> · <a href="#consents">Мои согласия и обращения</a></p>
            <p>Телефон {{ customer?.phone }} подтверждён и не редактируется.</p>
          </div>
          <v-btn
            icon="$close"
            variant="text"
            aria-label="Закрыть профиль"
            @click="emit('update:modelValue', false)"
          />
        </div>

        <div class="profile-photo">
          <span class="profile-photo__preview">
            <img
              v-if="photoUrl"
              :src="photoUrl"
              alt="Фотография профиля"
            >
            <v-icon
              v-else
              icon="$profile"
              size="38"
            />
          </span>
          <div>
            <strong>Фотография</strong>
            <small>JPEG, PNG или WebP, не более 5 МБ</small>
            <label class="photo-action">
              Загрузить
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

        <div class="profile-grid">
          <v-text-field
            v-model="form.lastName"
            label="Фамилия"
            maxlength="100"
            variant="outlined"
            :error-messages="fieldErrors('lastName')"
          />
          <v-text-field
            v-model="form.firstName"
            label="Имя"
            maxlength="100"
            variant="outlined"
            :error-messages="fieldErrors('firstName')"
          />
          <v-text-field
            v-model="form.patronymic"
            label="Отчество"
            maxlength="100"
            variant="outlined"
            :error-messages="fieldErrors('patronymic')"
          />
          <v-text-field
            v-model="form.email"
            label="Электронная почта"
            type="email"
            maxlength="254"
            variant="outlined"
            :error-messages="fieldErrors('email')"
          />
          <v-text-field
            v-model="form.inn"
            label="ИНН"
            inputmode="numeric"
            maxlength="12"
            variant="outlined"
            :error-messages="fieldErrors('inn')"
          />
          <v-text-field
            v-model="form.postalCode"
            label="Почтовый индекс"
            maxlength="20"
            variant="outlined"
            :error-messages="fieldErrors('postalCode')"
          />
          <v-text-field
            v-model="form.city"
            label="Город"
            maxlength="150"
            variant="outlined"
            :error-messages="fieldErrors('city')"
          />
          <v-text-field
            v-model="form.address"
            label="Адрес"
            maxlength="500"
            variant="outlined"
            :error-messages="fieldErrors('address')"
          />
        </div>

        <details class="passport-fields">
          <summary>Паспортные данные</summary>
          <div class="profile-grid">
            <v-text-field
              v-model="form.passportSeries"
              label="Серия"
              maxlength="32"
              variant="outlined"
              :error-messages="fieldErrors('passportSeries')"
            />
            <v-text-field
              v-model="form.passportNumber"
              label="Номер"
              maxlength="32"
              variant="outlined"
              :error-messages="fieldErrors('passportNumber')"
            />
            <v-text-field
              v-model="form.passportIssueDate"
              label="Дата выдачи"
              type="date"
              variant="outlined"
              :error-messages="fieldErrors('passportIssueDate')"
            />
            <v-text-field
              v-model="form.passportIssuedBy"
              class="profile-grid__wide"
              label="Кем выдан"
              maxlength="500"
              variant="outlined"
              :error-messages="fieldErrors('passportIssuedBy')"
            />
          </div>
        </details>

        <p
          v-if="error"
          class="form-error"
          role="alert"
        >
          {{ error }}
        </p>
        <p
          v-if="saved"
          class="form-success"
          role="status"
        >
          Профиль сохранён
        </p>

        <div class="profile-dialog__actions">
          <v-btn
            variant="text"
            :disabled="busy"
            @click="emit('update:modelValue', false)"
          >
            Отмена
          </v-btn>
          <v-btn
            type="submit"
            color="primary"
            :loading="busy"
          >
            Сохранить
          </v-btn>
        </div>
      </form>
    </v-card>
  </v-dialog>
</template>
