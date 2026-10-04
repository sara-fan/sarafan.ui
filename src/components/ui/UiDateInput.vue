<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, nextTick, ref, watch } from 'vue'
import { dateInputDisplay, dateInputIso, pickerDateIso } from '../../dateInput.js'
import { isIsoDate } from '../../api/validation.js'
import UiButton from './UiButton.vue'
defineOptions({ inheritAttrs:false })
const props = defineProps({
  modelValue:{ type:String, default:'' }, label:{ type:String, default:'Дата' },
  min:{ type:String, default:undefined }, max:{ type:String, default:undefined },
  disabled:Boolean, readonly:Boolean, allowInvalid:{ type:Boolean, default:true }
})
const emit = defineEmits(['update:modelValue'])
const draft = ref(dateInputDisplay(props.modelValue)), menu = ref(false), control = ref(null), input = ref(null), popup = ref(null)
const pickerValue = computed(() => isIsoDate(props.modelValue) && props.modelValue ? props.modelValue : null)
watch(() => props.modelValue, value => { draft.value = dateInputDisplay(value); menu.value = false })
watch(() => props.disabled || props.readonly, inactive => { if (inactive) menu.value = false })
watch(menu, async (open, previous) => {
  if (open || !previous) return
  await nextTick()
  const active = document.activeElement
  const restore = active === document.body || control.value?.contains(active) || popup.value?.contentEl?.contains(active)
  if (restore && !props.disabled && !props.readonly) input.value?.focus()
})
function change(value) {
  if (props.disabled || props.readonly) return
  const iso = dateInputIso(value ?? '')
  draft.value = dateInputDisplay(iso)
  if (props.allowInvalid || !iso || isIsoDate(iso)) emit('update:modelValue', iso)
}
async function select(value) {
  if (props.disabled || props.readonly) return
  const iso = value == null ? '' : pickerDateIso(value)
  if (iso && (!isIsoDate(iso) || props.min && iso < props.min || props.max && iso > props.max)) return
  change(iso)
  menu.value = false
  await nextTick()
  input.value?.focus()
}
function openCalendar() { if (!props.disabled && !props.readonly) menu.value = !menu.value }
</script>
<template>
  <div
    ref="control"
    class="ui-date-input"
  >
    <input
      ref="input"
      v-bind="$attrs"
      type="text"
      lang="ru"
      inputmode="numeric"
      placeholder="дд.мм.гггг"
      maxlength="10"
      class="ui-field__control"
      :value="draft"
      :disabled="disabled"
      :readonly="readonly"
      @input="change($event.target.value)"
    >
    <UiButton
      class="ui-date-input__calendar"
      variant="quiet"
      :aria-label="`Открыть календарь: ${label}`"
      :aria-expanded="menu"
      aria-haspopup="dialog"
      :disabled="disabled || readonly"
      @click="openCalendar"
    >
      <v-icon
        icon="$calendar"
        size="20"
        aria-hidden="true"
      />
    </UiButton>

    <v-menu
      ref="popup"
      v-model="menu"
      :disabled="disabled || readonly"
      :activator="control"
      :open-on-click="false"
      :close-on-content-click="false"
      :content-props="{ role:'dialog', 'aria-label':`Календарь: ${label}` }"
      location="bottom start"
    >
      <v-date-picker
        :model-value="pickerValue"
        :min="min"
        :max="max"
        :disabled="disabled || readonly"
        hide-header
        show-adjacent-months
        @update:model-value="select"
      />
    </v-menu>
  </div>
</template>
