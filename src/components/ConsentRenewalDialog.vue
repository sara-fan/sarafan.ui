<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, ref } from 'vue'
import { LEGAL_DOCUMENT_KIND } from '../consentFormatting.js'
import { presentProblem, presentProblemTitle, problemFieldErrors } from '../errors/problem.js'
import { useValidationFocus, validationFields } from '../validationFocus.js'
import { useConsents } from '../stores/consents.js'
import LegalDocumentReader from './LegalDocumentReader.vue'
import UiAlert from './ui/UiAlert.vue'
import UiButton from './ui/UiButton.vue'
import UiDialog from './ui/UiDialog.vue'
import UiSelectionControl from './ui/UiSelectionControl.vue'

const props = defineProps({ flow:{ type:Object, required:true } })
const state = computed(() => props.flow.state)
const consents = useConsents()
const focusRoot = ref(null)
function fieldName(kind) {
  return kind === LEGAL_DOCUMENT_KIND.USER_AGREEMENT ? 'userAgreement' : 'personalDataConsent'
}
function fieldErrors(row) {
  if (row.document.kind !== state.value.problemKind) return []
  return [...new Set(Object.keys(state.value.problem?.errors ?? {})
    .filter(field => /^(?:personalDataConsent|userAgreement|documentId|contentHash|decision|idempotencyKey)(?:\.|$)/iu.test(field))
    .flatMap(field => problemFieldErrors(state.value.problem, field)))]
}
function confirm() {
  return focusAfter(() => props.flow.confirm(), () => {
    if (state.value.problemKind === null) return []
    const name = fieldName(state.value.problemKind)
    return validationFields(state.value.problem, {
      aliases:{ personalDataConsent:name, userAgreement:name, documentId:name, contentHash:name, decision:name, idempotencyKey:name }
    })
  })
}
const focusAfter = useValidationFocus(focusRoot, {
  active:() => state.value.open && !state.value.reading,
  context:() => state.value.documents.map(row => row.document.id + ':' + row.document.contentHash),
  ready:() => !state.value.busy
})
</script>

<template>
  <UiDialog
    :model-value="state.open"
    title="Подтверждение документов"
    :persistent="state.busy"
    :max-width="480"
    @update:model-value="open => { if (!open) flow.cancel() }"
  >
    <div ref="focusRoot">
      <UiAlert
        v-if="state.problem"
        :title="presentProblemTitle(state.problem)"
      >
        {{ presentProblem(state.problem) }}
        <UiButton
          :disabled="state.busy"
          @click="flow.retry"
        >
          Обновить документы
        </UiButton>
      </UiAlert>
      <template v-if="state.reading">
        <h3>{{ state.reading.title }}</h3>
        <LegalDocumentReader :document="state.reading" />
        <UiButton @click="state.reading = null">
          Вернуться к подтверждению
        </UiButton>
      </template>
      <div
        v-else
        class="consent-registration"
      >
        <div
          v-for="row in state.documents"
          :key="row.document.id"
          class="consent-registration__item"
        >
          <div class="consent-inline-acceptance">
            <UiSelectionControl
              v-model="row.accepted"
              :name="fieldName(row.document.kind)"
              :error="fieldErrors(row).length > 0"
              :aria-labelledby="fieldName(row.document.kind) + '-renewal-label ' + fieldName(row.document.kind) + '-renewal-document'"
              :aria-describedby="fieldErrors(row).length ? fieldName(row.document.kind) + '-renewal-error' : undefined"
              :disabled="state.busy"
            >
              <span :id="fieldName(row.document.kind) + '-renewal-label'">{{ row.document.kind === LEGAL_DOCUMENT_KIND.USER_AGREEMENT ? 'Я принимаю' : 'Я даю' }}</span>
            </UiSelectionControl>
            <button
              :id="fieldName(row.document.kind) + '-renewal-document'"
              type="button"
              class="consent-document-link"
              :disabled="state.busy"
              @click.prevent="state.reading = row.document"
            >
              {{ consents.kindName(row.document.kind) }}
            </button>
          </div>
          <p
            v-if="fieldErrors(row).length"
            :id="fieldName(row.document.kind) + '-renewal-error'"
            class="consent-field-error"
          >
            {{ fieldErrors(row).join(' ') }}
          </p>
        </div>
      </div>
    </div>
    <template #actions>
      <UiButton
        variant="secondary"
        :disabled="state.busy"
        @click="flow.cancel"
      >
        Отмена
      </UiButton>
      <UiButton
        v-if="!state.reading"
        variant="primary"
        :loading="state.busy"
        :disabled="!state.documents.length || state.documents.some(row => !row.accepted)"
        @click="confirm"
      >
        Подтвердить и продолжить
      </UiButton>
    </template>
  </UiDialog>
</template>

<style scoped>
.consent-document-link { padding:0; border:0; background:transparent; text-align:left; cursor:pointer; }
</style>
