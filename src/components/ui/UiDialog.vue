<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { nextTick, useId, watch } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  title: { type: String, required: true },
  titleId: { type: String, default: '' },
  persistent: { type: Boolean, default: false },
  maxWidth: { type: [String, Number], default: 520 }
})

const emit = defineEmits(['update:modelValue'])
const generatedTitleId = `ui-dialog-${useId()}`
let opener = null

watch(() => props.modelValue, async (open, previous) => {
  if (open && !previous) opener = globalThis.document?.activeElement || null
  if (!open && previous) {
    await nextTick()
    const HTMLElementCtor = globalThis.HTMLElement
    if (HTMLElementCtor && opener instanceof HTMLElementCtor && globalThis.document?.contains(opener)) opener.focus()
    opener = null
  }
}, { immediate: true })
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    width="calc(100% - 32px)"
    :max-width="maxWidth"
    scrollable
    :persistent="persistent"
    :aria-labelledby="titleId || generatedTitleId"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card class="ui-dialog">
      <header class="ui-dialog__header">
        <h2 :id="titleId || generatedTitleId">
          {{ title }}
        </h2>
        <slot name="header" />
      </header>
      <div class="ui-dialog__body">
        <slot />
      </div>
      <footer
        v-if="$slots.actions"
        class="ui-dialog__actions"
      >
        <slot name="actions" />
      </footer>
    </v-card>
  </v-dialog>
</template>
