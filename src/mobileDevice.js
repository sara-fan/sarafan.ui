// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

export function isMobileDevice(deviceNavigator = globalThis.navigator) {
  const agent = deviceNavigator?.userAgent ?? ''
  // ArkWeb identifies Phone/Tablet separately from PC; touch and viewport are not device identities.
  const harmonyDevice = /\(\s*(Phone|Tablet|PC|2in1)\s*;\s*(?:OpenHarmony|HarmonyOS)\b/iu.exec(agent)
  if (harmonyDevice) return /^(Phone|Tablet)$/iu.test(harmonyDevice[1])
  if (deviceNavigator?.userAgentData?.mobile === true) return true
  return /Android|iPhone|iPad|iPod/iu.test(agent)
}
