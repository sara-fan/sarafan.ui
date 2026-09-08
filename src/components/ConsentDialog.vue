<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { nextTick, watch } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  title: { type: String, required: true },
  titleId: { type: String, required: true }
})

const emit = defineEmits(['update:modelValue'])
let opener = null

watch(() => props.modelValue, async (open, previous) => {
  if (open && !previous) opener = globalThis.document?.activeElement || null
  if (!open && previous) {
    await nextTick()
    const doc = globalThis.document
    const HTMLElementCtor = globalThis.HTMLElement
    if (HTMLElementCtor && opener instanceof HTMLElementCtor && doc?.contains(opener)) opener.focus()
    opener = null
  }
}, { immediate: true })
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    width="calc(100% - 32px)"
    max-width="520"
    scrollable
    :aria-labelledby="titleId"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card class="consent-dialog">
      <header class="consent-dialog__header">
        <h2 :id="titleId">
          {{ title }}
        </h2>
      </header>
      <div class="consent-dialog__body">
        <slot />
      </div>
      <footer
        v-if="$slots.actions"
        class="consent-dialog__actions"
      >
        <slot name="actions" />
      </footer>
    </v-card>
  </v-dialog>
</template>
