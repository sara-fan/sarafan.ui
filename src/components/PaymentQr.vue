<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { ref, watch, onUnmounted } from 'vue'
import UiButton from './ui/UiButton.vue'
import { createImagePreview } from '@sara-fan/ui-shared/image-preview'
import { createInternalProblem, normalizeProblem, presentProblem } from '../errors/problem.js'
import { useSession } from '../stores/session.js'

const props = defineProps({ url:{ type:String, required:true }, identity:{ type:String, required:true } })
const emit = defineEmits(['ready'])
const session = useSession(), source = ref(''), problem = ref(null)
const preview = createImagePreview({
  load:url => session.paymentQr(url),
  publish:({ source:value, error }) => { source.value = value; problem.value = error ? normalizeProblem(error) : null; emit('ready', false) },
  protocolError:() => createInternalProblem('protocolError')
})
watch([() => props.url, () => props.identity], () => preview.update(props), { immediate:true, flush:'sync' })
function loaded(event) { if (event.target.getAttribute('src') === source.value && source.value) emit('ready', true) }
function failed(event) { preview.failed(event.target.getAttribute('src')) }
onUnmounted(preview.dispose)
</script>
<template>
  <div class="payment-qr">
    <img
      v-if="source"
      :key="source"
      :src="source"
      alt="QR-код для оплаты заказа"
      @load="loaded"
      @error="failed"
    >
    <p
      v-else-if="problem"
      role="status"
    >
      QR-код недоступен. {{ presentProblem(problem) }}
    </p>
    <UiButton
      v-if="problem"
      @click="preview.update(props)"
    >
      Повторить загрузку QR-кода
    </UiButton>
    <p
      v-else-if="!source"
      role="status"
    >
      Загружаем QR-код…
    </p>
  </div>
</template>
<style scoped>
.payment-qr img { display:block; width:min(100%, 320px); height:auto; image-rendering:crisp-edges; }
</style>
