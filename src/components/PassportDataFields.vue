<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import UiField from './ui/UiField.vue'

defineProps({
  passport: { type: Object, required: true },
  disabled: { type: Boolean, default: false },
  errorsFor: { type: Function, default: () => [] }
})

const emit = defineEmits(['update:field'])
const update = (name, value) => emit('update:field', name, value)
</script>

<template>
  <div
    class="ui-form-grid"
  >
    <UiField
      :model-value="passport.inn"
      :disabled="disabled"
      name="inn"
      label="ИНН"
      inputmode="numeric"
      maxlength="12"
      :errors="errorsFor('inn')"
      @update:model-value="update('inn', $event)"
    />
    <UiField
      :model-value="passport.passportSeries"
      :disabled="disabled"
      name="passportSeries"
      label="Серия паспорта"
      maxlength="32"
      :errors="errorsFor('passportSeries')"
      @update:model-value="update('passportSeries', $event)"
    />
    <UiField
      :model-value="passport.passportNumber"
      :disabled="disabled"
      name="passportNumber"
      label="Номер паспорта"
      maxlength="32"
      :errors="errorsFor('passportNumber')"
      @update:model-value="update('passportNumber', $event)"
    />
    <UiField
      :model-value="passport.passportIssueDate"
      :disabled="disabled"
      name="passportIssueDate"
      label="Дата выдачи"
      type="date"
      :errors="errorsFor('passportIssueDate')"
      @update:model-value="update('passportIssueDate', $event)"
    />
    <div class="ui-form-grid__wide">
      <UiField
        :model-value="passport.passportIssuedBy"
        :disabled="disabled"
        name="passportIssuedBy"
        label="Кем выдан"
        multiline
        :rows="2"
        maxlength="500"
        :errors="errorsFor('passportIssuedBy')"
        @update:model-value="update('passportIssuedBy', $event)"
      />
    </div>
  </div>
</template>
