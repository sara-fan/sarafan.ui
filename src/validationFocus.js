// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { nextTick, onScopeDispose, watch } from 'vue'
import { createValidationFocus } from '@sara-fan/ui-shared/validation-focus'

export { validationFields } from '@sara-fan/ui-shared/validation-focus'
export const useValidationFocus = createValidationFocus({ nextTick, onScopeDispose, watch })
