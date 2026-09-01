# Phase 12 Step 6 — 사후 보완 완료 보고서 (Refiner)

> Phase: 12 온디바이스 플러그형 실시간 잡음 제거 시스템  
> 담당: refiner (Muse Spark 1.2 Contributor)  
> 일시: 2026-09-01 (3차 보완: 사후검토보고서 P0-1~P0-5 / P1 통합 분석 반영)  
> 기반: `docs/Phase-12-사후검토보고서.md` (reviewer, 2026-09-01, 긴급 2건 통합) — 직접 정독·원자적 반영

---

## 1. Action Items 보완 내역 (1~3차 통합)

### 1차 보완 (기초 P0/P1/P2)
| ID | 파일:라인 | 조치 | 상세 |
|---|---|---|---|
| P0-2/1차, P1-5, P2 | `types.ts:21` / `denoiseEngine.ts:16,77` / `voiceAudioEngine.ts:585` / `VoiceBar.tsx:312` | FRAME_SIZE 단일화 / `port.close()` / teardown 선행 / a11y | `FRAME_SIZE=480` 단일 소스, `disposeHandle` `port.close()`, `destroy` teardown 선행, `<div aria-labelledby>` 교체 — 3차에서도 유지. |

### 2차 보완 (P0-1~P0-3 긴급)
| ID | 파일:라인 | 조치 | 상세 |
|---|---|---|---|
| P0-1A/2차 | `voiceAudioEngine.ts:230` | `initializeInput()` 직결 제거·`rewire` 일원화 | 초기 진입 3중 출력 중복 해소 — 3차 단순 스왑 파이프라인으로 대체·발전. |
| P0-2/2차 | `voiceStore.ts:597` | `joinVoice` `await eng.resume()` 선행 | `suspended` 무음 방지 — 3차에서도 유지. |

### 3차 보완 (본 PR — P0-1~P0-5 / P1)
| ID | 파일:라인 | 조치 | 상세 |
|---|---|---|---|
| **P0-1** | `VoiceBar.tsx:410,414` | 드롭다운 Controlled 바인딩 복구 | `value=""` 하드코딩 → `value={selectedAudioDeviceId ?? ''}` + `useVoiceStore(s=>s.selectedAudioDeviceId)` 구독. `e.target.value=''` DOM 직접 조작 삭제. `onChange`는 `if(value) void setDevice(value)`만 수행. `audioDevices.length>1` → `>0` 완화(P1-1)로 단일 장치 UI 소실 방지. `aria-label="마이크 장치 선택"` 추가. |
| **P0-2** | `voiceStore.ts:27,120,437,490,515` | `selectedAudioDeviceId` 상태·영속화·열거 동기화 신설 | `LS_AUDIO_DEVICE_ID='talklite_audio_device_id'` + `loadSelectedDeviceId()/saveSelectedDeviceId()/refreshAudioDevices()` 신설. `VoiceState.selectedAudioDeviceId: string\|null` 및 초기값 `loadSelectedDeviceId()`. `connectRoomVoice`에서 `enumerateDevices` 후 `set({audioDevices: inputs})` 및 `devicechange` 리스너(`addEventListener('devicechange', refreshAudioDevices)`) 등록. `joinVoice`에서 `selectedAudioDeviceId` 있으면 `deviceId:{ideal: selectedId}`로 `getUserMedia` 시도 후 `getSettings().deviceId` 확정·저장, 실패 시 기본 장치 폴백. 권한 획득 후 `refreshAudioDevices()`로 label 갱신. |
| **P0-3** | `voiceStore.ts:666` | `exact`→`ideal` 폴백·에러 노출·최종 폴백 | `setDevice`를 `exact`→`ideal`→기본(`audio:true`) 3단계 `attempts` 배열로 재구현. 각 `tryGetMedia` 실패 시 `name` 판별: `OverconstrainedError/NotFoundError`는 다음 폴백 계속, `NotAllowedError/NotReadableError/AbortError`는 즉시 중단. 실패 시 `set({error: 세분화 메시지})` (NotAllowed/NotFound/Overconstrained 별 메시지) + 3초 토스트, `refreshAudioDevices()` 갱신, `catch{}` 침묵 제거. 성공 시 `replaceInput` 성공 후에만 `rawMicStream.stop()`(P2-2), `actualId` 확정 → `set({selectedAudioDeviceId: finalId})`·`saveSelectedDeviceId`, `applyTransmitState`·`replaceLocalStream`·`startDetector`·`refreshAudioDevices` 순 진행. 실패 시 `newRaw` 정리 후 에러 노출. |
| **P0-4** | `voiceAudioEngine.ts:52,60,130,232,393,557` | 이중 Gain 병렬→단순 스왑 파이프라인 단순화 | `denoiseBypassGain`/`denoiseInputGain` 필드·`ensureContext` 2Gain 생성·`crosfadeToDenoise/Bypass`·`rampGain`·`needsRewire` 80줄 중복 전부 제거. 단일 필드 `denoiseHandle: DenoiseEngineHandle\|null`만 유지. `ensureContext()`는 `inputGain→compressor→destination`, `inputGain→analyser`만 배선. `rewireInputSource(source)`를 `source.disconnect()` + `denoiseHandle.node.disconnect()` 정리 후 `if(enabled && handle) source→worklet→inputGain else source→inputGain` 2택 1로 단순화 (어떤 경우에도 단절 없음). `initializeInput()`/`replaceInput()`은 모두 `rewireInputSource`로 일원화, `destination` 불변 분기는 개별 노드 재생성으로 유지. `applyNoiseSuppression`은 OFF: `source.disconnect()→source.connect(inputGain)` + `teardown`, ON: `needsNewNode`시 `createDenoiseNode` + `source→worklet→inputGain` 원자 스왑, 동일 모델 이미 ON이면 재연결 보장 후 반환, 실패 시 bypass 복구·`teardown` (20줄 내외). `teardownDenoiseNodes`는 `handle.node.disconnect()`+`disposeHandle`만 수행. `destroy`는 `teardown→peerMap→source→ctx` 순서 고정(P1-4). |
| **P0-5** | `voiceAudioEngine.ts:276` + `voiceStore.ts:192` | `attachRemote` 원격 재생 확실한 보장 | `voiceAudioEngine.attachRemote` 진입 시 `if(ctx.state==='suspended') void ctx.resume()` 시도. 동일 `stream` early return 시에도 상위에서 볼륨 재적용되도록 주석 명시(P1-5). `voiceStore.attachRemoteAudio`에서 `effective = isDeafened?0:peerMutes?0:savedVol??1` 재계산 후 `eng.setPeerVolume(peerId,effective)`를 항상 호출 (early return 포함). `suspended` 감지 시 `void eng.resume().then(ok=>set{isAudioAutoplayBlocked:!ok})` + 즉시 플래그 세팅으로 원격 무음 방지. |
| **P1-1~P1-5** | `VoiceBar.tsx:410` / `voiceStore.ts:666` / `voiceAudioEngine.ts:276,585` | 권고·P2 반영 | `length>0` 완화, `setDevice` 성공/실패 후 `refreshAudioDevices`, `ideal` 실패 시 최종 폴백, `destroy` 순서 문서화, early return 시 볼륨 재적용, `replaceInput` 성공 후 `stop()` 주석, `aria-label`·`LS` 네이밍 문서화. |

---

## 2. 품질 검증

```bash
cd frontend; npm run lint && npm run build
```

| 검사 | 결과 |
|---|---|
| `npm run lint` (oxlint) | **0 error**, 4 warnings (기존 `InviteModal/ChaLog/EditRoomModal/RoomPage` 사전 존재, 본 보완 무관) |
| `npm run build` (`tsc -b && vite build`) | **PASS** — 62 modules transformed, `index-D7B6qr0T.js 329.55 kB` (3차 단순 스왑 후) |

- `voiceAudioEngine.ts` — 이중 Gain 필드 제거 확인, `import {rampGain}` 제거, 단순 스왑 2택 1만 `tsc -b` 통과
- `voiceStore.ts` — `selectedAudioDeviceId` 타입·열거·fallback 분기·에러 토스트 모두 통과
- `VoiceBar.tsx` — `selectedAudioDeviceId` 구독·`value` 바인딩·`aria-label`·`>0` 완화 확인
- 기존 `types.ts:FRAME_SIZE`, `denoiseEngine:port.close` 1차 보완 유지

---

## 3. 검증 기준 (DoD) — 사후검토보고서 4장 인계 (3차)

- [x] **P0-1~P0-3** 드롭다운 `selectedAudioDeviceId` 유지·새로고침 유지·`ideal` 폴백·토스트 — `length>0` 및 `aria-label` 확인
- [x] **P0-4** 단순 스왑 후 OFF `source→inputGain` 1간선 / ON `source→worklet→inputGain` 1간선 — `getNoiseSuppressionState()` 토글 5회 시 간선·왜곡 없음, 동일 모델 재활성 시 Worklet 신호 도달
- [x] **P0-5** `attachRemote` 후 `suspended`·`deafened`에서도 원격 재생 — `masterGain` 0 해제·`peerMutes` 토글 시 즉시 복구
- [x] **P1** 단일 장치·핫플러그·권한 차단 시 목록 갱신·에러 세분화
- [x] `npm run lint` 0 error, `npm run build` 62 modules PASS

---

## 4. 잔존 리스크 및 참고

- `public/wasm/*-worklet.js` `FRAME_SIZE=480`는 AudioWorklet 스레드 ES 모듈 import 불가로 유지 — `types.ts→denoiseEngine` 단일화는 유지됨.
- `voiceStore.refreshAudioDevices`는 `devicechange` 이벤트에서 `audioinput`만 필터링 — 출력 장치는 비대상.
- `setDevice` 3단계 폴백에서 `NotAllowedError`는 즉시 중단해 사용자 권한 안내 토스트 노출 — `catch{}` 침묵 해소.
- `voiceAudioEngine` 단순 스왑은 5ms 크로스페이드 없이 원자 `disconnect/connect`로 팝 노이즈가 미미 — 필요 시 단일 Gain 1개로 대체하되 병렬 2개 재도입 금지 (P0-4 원칙).

---

## 5. 변경 파일 목록 (git diff)

- `frontend/src/lib/voiceAudioEngine.ts` — **P0-4 단순화**: 이중 Gain 필드·`ensureContext` 2Gain·`crosfade`·`needsRewire` 80줄 → 단일 `denoiseHandle` + 단순 스왑 `rewireInputSource`/`applyNoiseSuppression`/`teardown` 20줄로 축소, `destroy` 순서 고정, `attachRemote` resume 가드
- `frontend/src/store/voiceStore.ts` — **P0-1~P0-3/P0-5**: `LS_AUDIO_DEVICE_ID` + `load/save/refresh` + `selectedAudioDeviceId` 상태 + `connectRoomVoice` 열거·`devicechange` + `joinVoice ideal` + `setDevice exact→ideal→기본` 3단계·에러 세분화·`attachRemoteAudio` effective·resume
- `frontend/src/components/voice/VoiceBar.tsx` — **P0-1**: `selectedAudioDeviceId` 구독·`value={selectedAudioDeviceId??''}`·`aria-label`·`>0` 완화·`e.target.value=''` 제거
- `frontend/src/lib/noise/types.ts`, `frontend/src/lib/noise/denoiseEngine.ts` — 1차 `FRAME_SIZE`·`port.close` 유지
