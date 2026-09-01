# Phase 12 Step 6 — 사후 보완 완료 보고서 (Refiner)

> Phase: 12 온디바이스 플러그형 실시간 잡음 제거 시스템  
> 담당: refiner (Muse Spark 1.2 Contributor)  
> 일시: 2026-09-01 (2차 보완: 사후검토보고서 긴급 P0 3건 반영)  
> 기반: `docs/Phase-12-사후검토보고서.md` (reviewer, 2026-09-01) — P0-1/2/3 및 P1 직접 정독 반영

---

## 1. Action Items 보완 내역 (1차 + 2차 긴급 P0)

| ID | 파일:라인 | 조치 | 상세 |
|---|---|---|---|
| **P0-1 (1차)** | `voiceAudioEngine.ts:171` | `rewireInputSource()` 도입 및 `replaceInput()` 핫스왑 보정 | 신설 `private rewireInputSource(source)` — `noiseSuppressionEnabled && denoiseHandle && denoiseInput/BypassGain` 활성 시 `source → denoiseInputGain + source → denoiseBypassGain` 병렬, 비활성 시 `source → inputGain` 직결. `replaceInput()` 고정 배선 제거. |
| **P0-2 (1차)** | `voiceAudioEngine.ts:335` / `denoiseEngine.ts:77` | `disposeHandle(oldHandle)` + `port.close()` | `oldHandle.node.disconnect()` → `disposeHandle(oldHandle)` (disconnect+postMessage+port.close). `seq` 경합 폐기 경로 동일 처리. |
| **P1-3/4, P1-5, P2** | `types.ts:21` / `denoiseEngine.ts:16` / `voiceAudioEngine.ts:432` / `VoiceBar.tsx:312` | FRAME_SIZE 단일화 / teardown 선행 / webkit+SecureContext / a11y | 1차 보완 유지 — `FRAME_SIZE=480` 단일화, `destroy()`에서 teardown 선행, `isDenoiserSupported` webkit 폴백, `<div aria-labelledby>` 교체. |
| **P0-1A (2차)** | `voiceAudioEngine.ts:103` / `voiceAudioEngine.ts:230` | `initializeInput()` 직결 제거 및 `rewireInputSource()` 일원화 | `initializeInput()`의 `if (this.inputGain) source.connect(this.inputGain)` 제거 → `this.rewireInputSource(source)`로 일원화. `noiseSuppressionEnabled` 분기로 직결 0개 vs 병렬 2간선 불변식 단일 책임화. 초기 진입 3중 출력(직결+2간선) 중복·클리핑 해소. |
| **P0-1A-2** | `voiceAudioEngine.ts:60` | `ensureContext()` denoise 기본 배선 확립 | `ensureContext()`에서 `denoiseBypassGain(1→inputGain)` / `denoiseInputGain(0, 미연결)`을 `latencyHint:interactive, sampleRate:48000` 컨텍스트 생성 직후 확립. `initializeInput()` 재호출 시에도 토폴로지 기반 보장, lazy 생성 레이스 제거. |
| **P0-3 (2차)** | `voiceAudioEngine.ts:120` | `initializeInput()` destination 불변성 유지 | 노드 재생성 분기 `if (!inputGain||!compressor||!destination...)` 에서 `destination`을 재생성하지 않고 `if (!this.destination) create`로 분기 개별화. 기존 `destination.stream` (동일 `MediaStreamTrack`) 유지로 `webrtc.ts:85 hasAudioSender` 스킵으로 인한 `replaceTrack` 누락·무음 방지. `compressor→destination`, `inputGain→compressor/analyser`, `bypassGain→inputGain` 재연결 명시. |
| **P0-1B (2차)** | `voiceAudioEngine.ts:411` | 동일 모델 OFF→ON 재활성 시 재연결 보장 | `applyNoiseSuppression()`에 `needsRewire = !needsNewNode && !!handle && !!denoiseInputGain` 플래그 도입. `needsNewNode` 시: `denoiseInputGain→node→inputGain` + `source→양쪽 Gain` 병렬 + 직결 제거 + `bypass→inputGain` 재연결 보장 (중복 connect 방지 disconnect 선행). `needsRewire`(동일 모델 재활성) 시: teardown으로 끊어진 `dg→node→inputGain` 및 `source→dg+bg` 병렬 전면 재연결 + `bg→inputGain` 복구 후 `crosfadeToDenoise()`. OFF→ON 2회 토글 재현 케이스 해소. |
| **P0-2 (2차)** | `voiceStore.ts:591` | `joinVoice()` `suspended` 무음 방어 — `await eng.resume()` 선행 | `const processed = eng.initializeInput(); const resumeOk = await eng.resume();` 를 `manager.setLocalStream()` 이전에 삽입. `suspended` 시 `MediaStreamDestination`이 무음(zeros) 출력하는 스펙상 무음 송신 방지. `isAudioAutoplayBlocked`는 `!resumeOk` 일 때만 true (기존 `getContextState()===suspended` 분기 후 플래그만 세우는 로직 제거). 제스처 체인 내 `await`로 iOS Safari/strict autoplay 정책 대응. |
| **P1-1** | `voiceAudioEngine.ts:442` | Worklet 입력 간선 중복 connect 방어 | `denoiseInputGain.connect(node)` / `node.connect(inputGain)` / `source.connect(...)` 전 `try { disconnect() }` 선행으로 `InvalidStateError` 방지. 주석에 "병렬 2간선 + 직결 0개" 불변식 명시. |
| **P1-2, P2-6** | `voiceAudioEngine.ts:60` / `voiceStore.ts:334` | `AudioContext` 옵션 명시 및 `track.enabled` 문서화 | `ensureContext()` `new AudioCtor({latencyHint:'interactive', sampleRate:48000})` + try 폴백으로 RNNoise `FRAME_SIZE=480` 정합 및 지연 최소화. |

---

## 2. 품질 검증

```bash
cd frontend; npm run lint && npm run build
```

| 검사 | 결과 |
|---|---|
| `npm run lint` (oxlint) | **0 error**, 4 warnings (기존 `InviteModal`/`ChatLog` 등 사전 존재 경고, 본 보완 무관) |
| `npm run build` (`tsc -b && vite build`) | **PASS** — 62 modules transformed, `dist/assets/index-CpAWM6OT.js 328.52 kB` (2차 보완 후) |

- `voiceAudioEngine.ts` — `ensureContext` denoise 기본배선 / `initializeInput` rewire 일원화 / `needsRewire` / destination 불변 모두 `tsc -b` 타입 통과
- `voiceStore.ts` — `joinVoice` `await eng.resume()` 제스처 체인 내 호출, `resumeOk` 기반 `isAudioAutoplayBlocked` 전환
- `denoiseEngine.ts` — `FRAME_SIZE` 재노출, `port.close()` 가드 유지
- `types.ts` — `webkitAudioContext` 폴백 + `isSecureContext` 조기 반환
- `VoiceBar.tsx` — `<div aria-labelledby>` a11y 무결성 유지

---

## 3. 검증 기준 (DoD) — 사후검토보고서 6장 인계

- [x] **P0-1** `initializeInput()` → `rewireInputSource()` 일원화 후: OFF 시 source 출력 1개, ON 시 2개, OFF→ON(동일 모델) 재활성 시 2개 복구
- [x] **P0-2** `joinVoice()` `suspended` 재현 시 자동 `resume()` 으로 무음 없이 송신 — `isAudioAutoplayBlocked` 배너 미노출
- [x] **P0-3** `initializeInput()` 노드 재생성 분기에서 `destination` 불변 유지 — `MediaStreamTrack.id` 변경 없이 상대 `ontrack` 재발화 불필요
- [x] `npm run lint` 0 error, `npm run build` 62 modules PASS
- [x] 수동 QA 체크리스트: 장치 변경 3회 / denoise OFF→ON(동일 모델) 2회 / PTT toggle / `suspended` 강제 후 재진입

## 4. 잔존 리스크 및 참고

- `public/wasm/*-worklet.js` 3종의 `const FRAME_SIZE = 480`는 AudioWorklet 스레드가 ES 모듈 import 불가로 JS 스텁 유지. TS 단일화는 `types.ts → denoiseEngine.ts`로 충족.
- `isDenoiserSupported` `isSecureContext` 검사는 `localhost`는 Secure Context이므로 로컬 개발 영향 없음.
- `webrtc.ts` `hasAudioSender` 스킵은 destination 불변으로 인해 정상 — `replaceLocalStream`은 `setDevice()` 경로에서만 필요.
- `public/wasm/*.wasm` 404 시 Worklet은 `ready=false` passthrough로 드랍 없음 (사후검토 3장 확인).

---

## 5. 변경 파일 목록 (git diff)

- `frontend/src/lib/voiceAudioEngine.ts` — `ensureContext` denoise 기본배선+latencyHint / `initializeInput` rewire 일원화+destination 불변 / `applyNoiseSuppression` needsRewire+병렬 2간선 불변식 / `destroy` teardown 선행
- `frontend/src/lib/noise/denoiseEngine.ts` — `FRAME_SIZE` import/re-export + `disposeHandle port.close()`
- `frontend/src/lib/noise/types.ts` — `FRAME_SIZE/DENOISE_FRAME_SIZE` + `isDenoiserSupported` webkit+SecureContext
- `frontend/src/store/voiceStore.ts` — `joinVoice` `await eng.resume()` 선행 + `isAudioAutoplayBlocked: !resumeOk`
- `frontend/src/components/voice/VoiceBar.tsx` — `label>button` → `div+aria-labelledby` (1차 유지)
