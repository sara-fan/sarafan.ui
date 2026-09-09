<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application
import { computed, defineComponent, ref } from 'vue'
import { documentNodes, moscowTime } from '../consentFormatting.js'
import { presentProblem } from '../errors/problem.js'
import UiButton from './ui/UiButton.vue'
const root = ref(null)
const props = defineProps({ document: { type:Object, required:true } })
defineEmits(['download'])
const parsed = computed(() => {
  try { return { nodes:documentNodes(props.document.html), problem:null } }
  catch (problem) { return { nodes:[], problem } }
})
const SafeBody = defineComponent({ setup:() => () => parsed.value.nodes })
function printDocument() {
  const printable = root.value.cloneNode(true)
  printable.id = 'sarafan-print-document'
  printable.style.display = 'none'
  globalThis.document.body.append(printable)
  try { globalThis.print() }
  finally { printable.remove() }
}
</script>
<template>
  <article
    ref="root"
    class="legal-document"
    :aria-label="document.title"
  >
    <header class="legal-document__meta">
      <p>Версия {{ document.displayVersion }} · {{ moscowTime(document.effectiveAt) }}</p>
      <div class="legal-document__actions">
        <UiButton
          variant="quiet"
          @click="$emit('download')"
        >
          Скачать Markdown
        </UiButton>
        <UiButton
          variant="quiet"
          @click="printDocument"
        >
          Печать
        </UiButton>
      </div>
    </header>
    <p
      v-if="parsed.problem"
      class="consent-alert"
      role="alert"
    >
      {{ presentProblem(parsed.problem) }}
    </p>
    <div
      v-else
      class="legal-document__body"
    >
      <SafeBody />
    </div>
  </article>
</template>
<style>
@media print {
  body:has(> #sarafan-print-document) > :not(#sarafan-print-document) { display:none !important; }
  #sarafan-print-document { display:block !important; max-width:none; }
}
</style>
