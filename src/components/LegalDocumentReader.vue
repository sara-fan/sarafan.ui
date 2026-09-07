<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application
import { computed, defineComponent, ref } from 'vue'
import { documentNodes, moscowTime } from '../consentFormatting.js'
import { presentProblem } from '../errors/problem.js'
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
  >
    <header>
      <h2>{{ document.title }}</h2>
      <p>Версия {{ document.displayVersion }} · {{ moscowTime(document.effectiveAt) }}</p>
      <div class="legal-document__actions">
        <button
          type="button"
          @click="$emit('download')"
        >
          Скачать Markdown
        </button>
        <button
          type="button"
          @click="printDocument"
        >
          Печать
        </button>
      </div>
    </header>
    <p
      v-if="parsed.problem"
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
<style scoped>
.legal-document { max-width: 60rem; color: #172c46; line-height: 1.65; overflow-wrap: anywhere; }
.legal-document h2 { margin: 0 0 .5rem; }
.legal-document__actions { display:flex; gap:1rem; margin:1rem 0; flex-wrap:wrap; }
.legal-document button { border:1px solid #1976d2; padding:.45rem .8rem; border-radius:4px; color:#1565c0; }
.legal-document__body :deep(table) { display:block; overflow-x:auto; border-collapse:collapse; max-width:100%; }
.legal-document__body :deep(th), .legal-document__body :deep(td) { border:1px solid #bacbdf; padding:.5rem; }
.legal-document__body :deep(ul), .legal-document__body :deep(ol) { padding-left:1.8rem; }
.legal-document__body :deep(p) { margin:.7rem 0; }
.legal-document__body :deep(a) { color:#1565c0; text-decoration:underline; }
@media print { .legal-document__actions { display:none; } .legal-document__body :deep(table) { display:table; } }
</style>

<style>
@media print {
  body:has(> #sarafan-print-document) > :not(#sarafan-print-document) { display:none !important; }
  #sarafan-print-document { display:block !important; max-width:none; }
}
</style>
