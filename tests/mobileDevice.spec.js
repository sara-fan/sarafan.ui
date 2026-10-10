// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { expect, it } from 'vitest'
import { isMobileDevice } from '../src/mobileDevice.js'

it.each([
  [{ userAgentData:{ mobile:true }, userAgent:'desktop-shaped agent' }, true],
  [{ userAgentData:{ mobile:false }, userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel)' }, true],
  [{ userAgent:'Mozilla/5.0 (Linux; Android 14; Tablet)' }, true],
  [{ userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }, true],
  [{ userAgent:'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)' }, true],
  [{ userAgent:'Mozilla/5.0 (iPod touch; CPU iPhone OS 18_0 like Mac OS X)' }, true],
  [{ userAgent:'Mozilla/5.0 (Phone; OpenHarmony 5.0) AppleWebKit/537.36 ArkWeb/4.1.6.1 Mobile' }, true],
  [{ userAgent:'Mozilla/5.0 (Tablet; OpenHarmony 5.0) AppleWebKit/537.36 ArkWeb/4.1.6.1', maxTouchPoints:10 }, true],
  [{ userAgent:'Mozilla/5.0 (Phone;HarmonyOS 5.1) AppleWebKit/537.36 ArkWeb/4.1.6.1 Mobile' }, true],
  [{ userAgent:'Mozilla/5.0 (Tablet; HarmonyOS 5.1) AppleWebKit/537.36 ArkWeb/4.1.6.1' }, true],
  [{ userAgent:'Mozilla/5.0 (PC; OpenHarmony 5.0) AppleWebKit/537.36 ArkWeb/4.1.6.1', maxTouchPoints:10 }, false],
  [{ userAgent:'Mozilla/5.0 (PC; HarmonyOS 5.1) AppleWebKit/537.36 ArkWeb/4.1.6.1', userAgentData:{ mobile:true } }, false],
  [{ userAgent:'Mozilla/5.0 (2in1; OpenHarmony 5.0) AppleWebKit/537.36 ArkWeb/4.1.6.1', maxTouchPoints:10 }, false],
  [{ userAgent:'Mozilla/5.0 ( phone ; harmonyos 5.1) ArkWeb/4.1.6.1' }, true],
  [{ userAgent:'Mozilla/5.0 (Linux; Android 12; HUAWEI P60 Pro) AppleWebKit/537.36 Mobile Safari/537.36' }, true],
  [{ userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', maxTouchPoints:5 }, false],
  [{ userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', maxTouchPoints:0 }, false],
  [{ userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints:10 }, false],
  [{ userAgent:'Mozilla/5.0 (X11; Linux x86_64)', userAgentData:{ mobile:false } }, false],
  [{ userAgent:'Mozilla/5.0 (X11; Linux x86_64)', maxTouchPoints:10 }, false],
  [{ maxTouchPoints:10 }, false],
  [{}, false],
  [null, false]
])('classifies the device independently of viewport: %j', (navigator, expected) => {
  expect(isMobileDevice(navigator)).toBe(expected)
})
