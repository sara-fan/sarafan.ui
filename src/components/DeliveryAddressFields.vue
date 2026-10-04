<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import UiField from './ui/UiField.vue'
defineProps({ address: { type:Object, required:true }, disabled: { type:Boolean, default:false }, required: { type:Boolean, default:false }, errorsFor: { type:Function, default:() => [] } })
const emit = defineEmits(['update:field'])
const fields = [{ name:'postalCode', label:'Индекс', max:20 }, { name:'city', label:'Регион, населённый пункт', max:150 }, { name:'address', label:'Адрес', max:500 }]
</script>
<template>
  <div class="ui-form-grid">
    <div
      v-for="field in fields"
      :key="field.name"
      :class="{ 'ui-form-grid__wide': field.name === 'address' }"
    >
      <UiField
        :model-value="address[field.name]"
        :name="field.name"
        :label="field.label"
        :maxlength="field.max"
        :multiline="field.name === 'address'"
        :rows="2"
        :required="required"
        :disabled="disabled"
        :errors="errorsFor(field.name)"
        @update:model-value="emit('update:field', field.name, $event)"
      />
    </div>
  </div>
</template>
