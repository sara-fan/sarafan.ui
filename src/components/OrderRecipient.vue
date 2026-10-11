<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed } from 'vue'
import UiField from './ui/UiField.vue'
import UiPanel from './ui/UiPanel.vue'

const props = defineProps({ profile:{ type:Object, required:true } })
const name = computed(() => [props.profile.lastName, props.profile.firstName, props.profile.patronymic].filter(Boolean).join(' '))
</script>

<template>
  <UiPanel title="Получатель">
    <div class="ui-field-grid">
      <UiField
        :model-value="name"
        label="ФИО"
        readonly
      />
      <UiField
        :model-value="profile.phone"
        label="Подтверждённый телефон"
        readonly
      />
      <UiField
        :model-value="profile.email || 'Не указан'"
        label="Email"
        readonly
      />
    </div>
  </UiPanel>
</template>
