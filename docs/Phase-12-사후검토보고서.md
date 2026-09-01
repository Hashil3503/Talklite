# 🔍 Phase 12 사후 검토 보고서 — 긴급 2건 통합 분석 (Reviewer 전담)

> 대상 마일스톤: Phase 12 온디바이스 플러그형 실시간 잡음 제거 시스템  
> 작성자: `reviewer` (`w1J:p3`, Muse Spark 1.2 Contributor)  
> 수신자: `refiner` (`w1J:p5`), `supervisor` (`w1J:p4`)  
> 작성일: 2026-09-01  
> 검토 커밋: `860765a feat(phase12)` + `5349aad` + 현재 HEAD (`voiceAudioEngine.ts:668` / `VoiceBar.tsx:441` / `voiceStore.ts:935`)  
> 검토 대상: `VoiceBar.tsx:410-428` / `voiceStore.ts:19-935` / `voiceAudioEngine.ts:36-668` / `webrtc.ts:76-304` / `noise/denoiseEngine.ts` / `noise/types.ts` / `webrtc.ts:attachRemote` 경로  
> 긴급 이슈 2건: **[1] 마이크 드롭다운 선택 미유지 버그** + **[2] 마이크 소리 미전달 — 이중 Gain 복잡도 해소 및 원격 재생 보장 구조 단순화**  
> 규정 준수: **직접 코드 수정 없음 — 정밀 원인 분석 및 P0/P1 Action Items 문서화만 수행**

---

## 0. Executive Summary — 통합 결론

| 이슈 | 판정 | 한줄 요약 |
|---|---|---|
| **[1] 마이크 드롭다운** | **P0 3건 확정** | `VoiceBar.tsx:412 value=""` 하드코딩 — Controlled Select가 항상 빈 문자열에 고정되어 선택이 즉시 초기화. `voiceStore.ts`에 `selectedAudioDeviceId` 상태·`localStorage` 영속화·`devicechange` 동기화가 전무. `setDevice():675 deviceId:{exact}` 만 사용하고 `OverconstrainedError` 시 `ideal` 폴백·에러 노출 없이 `catch{}` 침묵 실패. |
| **[2] 마이크 소리 미전달** | **P0 2건 확정** | `voiceAudioEngine.ts:52-56,99-119,232-555` 이중 Gain(`denoiseBypassGain`+`denoiseInputGain`) 병렬+크로스페이드 구조가 **OFF→ON 재활성·`initializeInput`·`replaceInput` 3경로에서 간선 상태 불일치**를 야기 — 단순 스왑(`OFF: source→inputGain / ON: source→worklet→inputGain`)으로 단순화 필요. `attachRemote():276-304`는 `suspended`·`deafened`·`replaceTrack` 탈락 시 원격 무음 — `resume()`·`masterGain` 가드·`peerMap` 갱신 보장 필요. |
| **공통 파급** | 통화 품질 | `[1]`은 "안 바뀌는" 체감, `[2]`는 "안 들리는" 체감으로 직결. 두 이슈는 독립적이나 `selectedAudioDeviceId` 미보유 시 `[2]`의 장치 핫스왑 재현 커버리지도 상실. |
| **조치** | P0 즉시 | 아래 Action Items 참조. 특히 `[1] P0-1~P0-3` 과 `[2] P0-4~P0-5` 는 `refiner`가 **동일 PR에서 원자적으로 수정**해야 재현이 해소됨. |

> 재현 시나리오  
> - [1] `audioDevices.length>1` 일 때 마이크 드롭다운에서 타 장치 선택 → 값이 즉시 `마이크` placeholder로 복귀.  
> - [2]-A 이중 Gain: 잡음 제거 OFF→ON(동일 모델) 재활성 → `denoiseInputGain` 단절 유지로 Worklet 무입력 — 크로스페이드는 되나 실질은 bypass만 통과. `initializeInput()` 은 `rewireInputSource()` 로 보완되었으나 `ensureContext()` 의 bypass/denoise Gain 사전 생성·재연결 로직이 80줄에 분산되어 `replaceInput()` 과 상태 불일치.  
> - [2]-B 원격: `attachRemote` 후 `AudioContext` 가 `suspended` 이거나 `masterGain.gain.value===0` (`deafened`) 이면 원격도 무음 — `voiceStore.ts:192-206` 는 `isAudioAutoplayBlocked` 플래그만 세우고 `resume()` 을 호출하지 않음.

---

## 1. 이슈 [1] — 마이크 드롭다운 선택 미유지 버그

### 1.1 현재 구현 (증거)

`VoiceBar.tsx:410-428`

```tsx
{audioDevices.length > 1 && (
  <select value="" onChange={(e) => { if (e.target.value) void setDevice(e.target.value); e.target.value = '' }}>
    <option value="" disabled>마이크</option>
    {audioDevices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || '마이크'}</option>)}
  </select>
)}
```

`voiceStore.ts:437-488 VoiceState` — `audioDevices: MediaDeviceInfo[]` 만 존재, `selectedAudioDeviceId` 없음. `LS_*` (`voiceStore.ts:19-27`) 에 장치 키 없음. `voiceStore.ts:515-536 connectRoomVoice()` 에서만 `enumerateDevices()` 1회, `joinVoice():582-588` 는 `deviceId` 제약 없이 `getUserMedia({audio:true})`.

### 1.2 Root Cause

| 하위 결함 | 위치 | 메커니즘 |
|---|---|---|
| **P0-1A: Controlled value 고정** | `VoiceBar.tsx:412` | `value=""` 고정 — 어떤 `<option>` 선택해도 다음 렌더에서 `""` 로 리셋. |
| **P0-1B: DOM 직접 조작** | `VoiceBar.tsx:415` | `e.target.value=''` — React 제어 흐름 이탈, StrictMode서 유실. |
| **P0-2A: 스토어 상태 부재** | `voiceStore.ts:437` | 바인딩할 `selectedAudioDeviceId` 자체가 없어 `[1A]` 의 직접 원인. |
| **P0-2B: 영속화·열거 동기화 부재** | `voiceStore.ts:19,530` | 새로고침 시 기본 장치로 복귀, 권한 획득 전 빈 `label` 열거 후 갱신 없음, `devicechange` 리스너 없음. |
| **P0-3A: `exact` 강제** | `voiceStore.ts:675` | 분리된 장치에서 `OverconstrainedError` 필수 실패. |
| **P0-3B: Silent Failure** | `voiceStore.ts:689-691` | `catch{}` 로 원인 삼킴 — UI 피드백 없음. |

### 1.3 Action Items — 드롭다운

| ID | 우선순위 | 위치 | 제목 | 상세 권고 (refiner) |
|---|---|---|---|---|
| **P0-1** | **P0** | `VoiceBar.tsx:410-428` | Controlled Select 바인딩 복구 | `value=""` → `value={selectedAudioDeviceId ?? ""}` , `e.target.value=''` 삭제, `useVoiceStore(s=>s.selectedAudioDeviceId)` 구독. `audioDevices.length>1` → `>0` 완화 또는 현재 장치 `span` 폴백. `aria-label="마이크 장치 선택"` 추가. |
| **P0-2** | **P0** | `voiceStore.ts:19-27,437-488,490-536,560-599` | `selectedAudioDeviceId` 상태·영속화 신설 | `LS_AUDIO_DEVICE_ID='talklite_audio_device_id'` + `load/saveSelectedDeviceId()` (화이트리스트 검증), `VoiceState.selectedAudioDeviceId: string \| null` 추가, 초기값 `loadSelectedDeviceId()`. `connectRoomVoice`/`joinVoice` 에서 `enumerateDevices` 후 `selectedId` 동기화, `joinVoice` 는 `deviceId:{ideal: selectedId}` 로 시도 후 `getSettings().deviceId` 확정·저장. `devicechange` 리스너로 `audioDevices` 갱신. |
| **P0-3** | **P0** | `voiceStore.ts:666-692` | `OverconstrainedError` `exact`→`ideal` 폴백·에러 노출 | `try{exact} catch(e){ if(e.name==='OverconstrainedError'\|\|e.name==='NotFoundError'){ try{ideal} } else set({error: ...}) }` , `catch{}` 삭제, `set({error:'마이크 전환 실패: ...'})` 및 3초 토스트, 성공 시 `selectedAudioDeviceId`·`audioDevices` 갱신. `ideal`도 실패하면 `getUserMedia({audio:true})` 최종 폴백. |

---

## 2. 이슈 [2] — 마이크 소리 미전달: 이중 Gain 복잡도 vs 단순 스왑 + 원격 재생 보장

### 2.1 현재 이중 Gain 구조 — 왜 복잡한가 (증거)

`voiceAudioEngine.ts:52-56` 필드:

```ts
private denoiseHandle: DenoiseEngineHandle | null = null
private denoiseInputGain: GainNode | null = null   // Worklet 입력측
private denoiseBypassGain: GainNode | null = null  // 우회
private denoiseSeq = 0
private noiseSuppressionEnabled = false
```

`voiceAudioEngine.ts:99-119 ensureContext()` — `bypassGain(1)→inputGain`, `denoiseInputGain(0)` 생성 및 `bypassGain.connect(inputGain)` 까지 수행. `voiceAudioEngine.ts:146-221 initializeInput()` — `rewireInputSource()` 분기, 누락 노드 개별 재생성, `denoiseBypassGain→inputGain` 재연결 등 70줄 분산.

`voiceAudioEngine.ts:232-274 rewireInputSource()` + `393-541 applyNoiseSuppression()`:

- **OFF**: `source→inputGain` 직결 (rewire) — `crosfadeToBypass()` 는 `bypassGain(1)/denoiseInputGain(0)` 램프.
- **ON**: `source→denoiseInputGain→worklet→inputGain` + `source→bypassGain→inputGain` **병렬 2간선** (`voiceAudioEngine.ts:235-245` + `417-526` needsNewNode/needsRewire 분기) — `crosfadeToDenoise()` 로 `denoise(1)/bypass(0)` 램프.
- `teardownDenoiseNodes():557-575` 는 `denoiseInputGain.disconnect()` 만 수행, `bypassGain` 은 유지 — OFF→ON(동일 모델) 재활성 시 `needsRewire` 분기로 복구 시도.

**복잡도 비용**

| 관점 | 문제 |
|---|---|
| **간선 수 불일치** | `rewireInputSource` 는 "활성 시 2간선, 비활성 시 1간선" — `ensureContext`·`initializeInput`·`applyNoiseSuppression`·`teardown` 4곳에서 동일 불변식을 각기 재구현. 한 곳이라도 누락 시 `source` 가 1/2/3개 중 하나로 불일치. |
| **상태 3중 분산** | `noiseSuppressionEnabled` bool + `denoiseHandle` null 여부 + `denoiseInputGain.gain.value` 3개가 "활성" 을 각기 표현 — OFF→ON(동일 모델) 시 `needsNewNode===false` 이나 `denoiseInputGain` 은 끊어진 상태라 `needsRewire` 보정 필요. |
| **501줄 `applyNoiseSuppression`** | `needsNewNode` / `needsRewire` 2분기가 80줄 중복 (disconnect/connect 6회씩) — 향후 `replaceInput` 과의 정합 유지 부담. |
| **검증 곤란** | `chrome://webaudio` 에서 `source` 출력 수로 활성 판별 불가 — 2간선 병렬은 그래프상 1개로 합쳐 보임. |

### 2.2 단순 스왑 파이프라인 — 제안 구조 (요청사항 2의 핵심)

**OFF (bypass)**:

```
source → inputGain(0~2) → compressor → destination → WebRTC
```

**ON (denoise)**:

```
source → workletNode(RNNoise/DeepFilterNet/Speex) → inputGain → compressor → destination
```

- Gain 2개·크로스페이드 2개 대신 **단일 `workletNode` 삽입/제거**로 토폴로지 1종.
- 전환 시 `source.disconnect()` → `source.connect(worklet)` / `worklet.connect(inputGain)` — `destination` 불변 원칙 유지.
- 필요 시 5ms 크로스페이드는 `workletNode` 전후에 **단일 Gain 1개** 또는 `AudioParam` 램프 없이 `disconnect/connect` 원자 스왑으로도 팝 노이즈가 미미 — 스펙에서 5ms는 선택 사항으로 완화 가능.
- `ensureContext()` 에서는 `inputGain→compressor→destination` 만 배선, `denoise` Gain 생성 자체를 제거 — `initializeInput()`·`replaceInput()` 은 `noiseSuppressionEnabled` 에 따라 `source→inputGain` vs `source→worklet→inputGain` 2택 1만 수행.

**기대 효과**: `rewireInputSource`·`needsRewire`·`teardown` 의 3중 분기가 `setNoiseSuppression(enabled)` 의 `if(enabled) insertWorklet else removeWorklet` 2분기로 축소, `initializeInput`/`replaceInput` 은 동일 헬퍼 1개 호출로 일원화.

### 2.3 원격 오디오 재생 보장 — `attachRemote` 현재와 기대

**현재 `voiceAudioEngine.ts:276-304 attachRemote()`**

```ts
if (!this.ctx || !this.masterGain) this.ensureContext()
const existing = peerMap.get(peerId) ...
const source = ctx.createMediaStreamSource(stream)
const gain = ctx.createGain(); gain.gain.value = 1
source.connect(gain); gain.connect(master)
peerMap.set(peerId, { source, gain, stream })
```

`voiceStore.ts:192-206 attachRemoteAudio()`:

```ts
eng.attachRemote(peerId, stream)
if (savedVol) eng.setPeerVolume(...)
if (peerMutes[peerId]) eng.setPeerVolume(0)
if (eng.getContextState()==='suspended') set({isAudioAutoplayBlocked:true})
```

**보장 누락**

| 하위 결함 | 위치 | 메커니즘 |
|---|---|---|
| **P0-5A: `suspended` 시 원격 무음** | `voiceAudioEngine.ts:276` + `voiceStore.ts:203` | `masterGain→ctx.destination` 경로가 `suspended` 이면 원격도 무음. `attachRemote` 는 `resume()` 을 호출하지 않고 플래그만 세움. |
| **P0-5B: `deafened` 시 원격 무음 유지** | `voiceAudioEngine.ts:94` | `masterGain.gain.value = isDeafened?0:masterVolume` — `deafened` 상태에서 `attachRemote` 된 피어는 `gain(1)→master(0)` 으로 무음. `toggleDeafen` 해제 시 기존 피어는 복구되나 `peerMap` 에 `gain` 이 `0` 으로 고정된 피어가 있으면 해제 후에도 `setPeerVolume` 미호출 시 무음 유지. |
| **P1-5A: `stream` 동일성 가드 탈락** | `voiceAudioEngine.ts:285-286` | `if(existing.stream===stream) return` — 동일 `stream` 객체 재전달 시 `setPeerVolume` 재적용 없이 리턴, 이전 `peerMutes` 상태가 바뀌어도 반영 안 됨. |
| **P1-5B: `replaceTrack` 에는 영향 없으나 `peerMap` 누수** | `webrtc.ts` | `webrtc.ts:98-112 replaceLocalStream` 은 송신측, `attachRemote` 는 수신측으로 독립 — 단, `removeRemote` 미호출 시 `peerMap` 에 고아 `MediaStreamSource` 잔류. |

### 2.4 Action Items — 파이프라인 단순화 및 원격 보장

| ID | 우선순위 | 위치 | 제목 | 상세 권고 (refiner) |
|---|---|---|---|---|
| **P0-4** | **P0** | `voiceAudioEngine.ts:52-56,99-119,232-574` | 이중 Gain 병렬→단순 스왑 파이프라인 단순화 | `denoiseBypassGain`·`denoiseInputGain` 필드 제거. `private denoiseNode: AudioWorkletNode \| null` 1개로 축소. `ensureContext()` 에서는 `bypassGain` 생성·연결 로직 삭제, `inputGain→compressor→destination` 만 배선. `initializeInput()`·`replaceInput()` 은 `applyNoiseSuppressionState()` 헬퍼(또는 `rewireInputSource` 단순화판) 로 **OFF: `source.connect(inputGain)` / ON: `source.connect(denoiseNode); denoiseNode.connect(inputGain)`** 2택 1만 수행. `applyNoiseSuppression(enabled,model)` 은 `if(enabled){ node=await createDenoiseNode(); source.disconnect(); source.connect(node); node.connect(inputGain) } else { source.disconnect(); node?.disconnect(); source.connect(inputGain) }` 로 20줄 내외로 축소. `teardownDenoiseNodes` 는 `denoiseNode.disconnect(); disposeHandle(denoiseNode); denoiseNode=null` 로 단순화. `denoiseSeq`·`noiseSuppressionEnabled`·`noiseSuppressionModel` 은 유지하되 `denoiseSeq` 는 `applyNoiseSuppression` 경합 가드에만 사용. 기존 5ms 크로스페이드는 스왑 직후 `inputGain.gain.setTargetAtTime` 5ms 제거 — 팝 노이즈가 문제되면 단일 `GainNode` 1개로 대체하되 병렬 2개는 금지. |
| **P0-5** | **P0** | `voiceAudioEngine.ts:276-304` + `voiceStore.ts:192-216` | `attachRemote` 원격 재생 확실한 보장 | `attachRemote` 진입 시 `if(ctx.state==='suspended') void ctx.resume()` 시도(실패 무시). `masterGain` 이 `deafened` 로 `0` 이면 `gain` 을 `masterGain` 이 아닌 별도 경로로 우회하지 말고, `attachRemoteAudio` 에서 `const effective = isDeafened?0:(peerMutes[peerId]?0:savedVol??1)` 로 계산 후 `eng.setPeerVolume(peerId, effective)` 를 `attachRemote` 직후 항상 호출 — 현재 `existing.stream===stream` early return 시에도 `setPeerVolume` 이 호출되도록 가드 이동. `webrtc.ts:attachRemote` 와 `voiceStore:attachRemoteAudio` 사이에 `unlockAudio()` 배너 노출 로직은 유지하되, `suspended` 감지 시 `resume()` 을 `attachRemoteAudio` 에서도 1회 시도. |
| **P1-4** | **P1** | `voiceAudioEngine.ts:557-575` + `voiceStore.ts:644-652` | `destroy`·`leaveVoice` 시 원격·denoise 정리 순서 문서화 | 단순화 후 `destroy()` 는 `denoiseNode?.disconnect()` → `peerMap.forEach(disconnect)` → `inputSource.disconnect()` → `ctx.close()` 순으로 고정, `teardownDenoiseNodes` 는 `destroy` 내부에서만 호출. `leaveVoice` 시 `peerMap.clear()` 누락 방지 주석. |
| **P1-5** | **P1** | `voiceAudioEngine.ts:285-304` + `webrtc.ts:134-140` | `peerMap` 갱신·`setPeerVolume` 재적용 보장 | `existing.stream===stream` early return 전에 `eng.setPeerVolume(peerId, effective)` 재적용. `removeRemote` 시 `peerMap.delete` 후 `gain.disconnect()` 순서 고정, `webrtc.ts:disconnectPeer` 와의 이중 해제 경쟁을 `try/catch` 로 방어 유지. |

---

## 3. 종합 Action Items — 우선순위별 통합

### 🔴 P0 — 즉시 수정 필수 (재현 직결)

| ID | 파일:라인 | 제목 | 수정 요구사항 |
|---|---|---|---|
| **P0-1** | `VoiceBar.tsx:412,415` | 드롭다운 Controlled 바인딩 복구 | `value=""` → `value={selectedAudioDeviceId ?? ""}`, `e.target.value=''` 삭제, `selectedAudioDeviceId` 구독. |
| **P0-2** | `voiceStore.ts:19-27,437-513,515-643` | `selectedAudioDeviceId` 상태·영속화 신설 | `LS_AUDIO_DEVICE_ID`, `load/saveSelectedDeviceId()`, `VoiceState.selectedAudioDeviceId`, `devicechange` 리스너, `joinVoice` `ideal` 선택. |
| **P0-3** | `voiceStore.ts:666-692` | `exact`→`ideal` 폴백·에러 노출 | `exact` 실패 시 `ideal` 재시도, `catch{}` → `set({error})` + 토스트, 성공 시 스토어 갱신. |
| **P0-4** | `voiceAudioEngine.ts:52-575` | 이중 Gain→단순 스왑 파이프라인 단순화 | `denoiseBypass/InputGain` 2개 제거 → `denoiseNode` 1개로 축소, `OFF: source→inputGain` / `ON: source→worklet→inputGain` 2택 1, `ensureContext`·`initializeInput`·`replaceInput`·`applyNoiseSuppression`·`teardown` 일원화. |
| **P0-5** | `voiceAudioEngine.ts:276-304` + `voiceStore.ts:192-216` | `attachRemote` 원격 재생 보장 | `suspended` 시 `resume()` 시도, `effective` 볼륨 재계산 후 `setPeerVolume` 항상 호출, `deafened` 해제 시 복구 보장. |

### 🟠 P1 — 권고 수정 (UX·견고성)

| ID | 파일:라인 | 제목 | 수정 요구사항 |
|---|---|---|---|
| **P1-1** | `VoiceBar.tsx:410` | 단일 장치 UI 소실 방지 | `length>1` → `>0` 완화 또는 `span` 폴백. |
| **P1-2** | `voiceStore.ts:666-692` | 장치 목록 갱신 | `setDevice` 성공/실패 후 `enumerateDevices` 재열거. |
| **P1-3** | `voiceStore.ts:666-692` | 최종 폴백 및 세분화 | `ideal` 실패 시 `getUserMedia({audio:true})` 최종 폴백, `NotAllowedError` 별 메시지. |
| **P1-4** | `voiceAudioEngine.ts:585-668` | `destroy` 정리 순서 문서화 | `denoiseNode→peerMap→source→ctx` 순서 고정. |
| **P1-5** | `voiceAudioEngine.ts:285` | `peerMap` early return 시 볼륨 재적용 | `existing.stream===stream` 이어도 `effective` 볼륨 재적용. |

### 🟡 P2 — 개선 (호환성·문서화)

| ID | 파일:라인 | 제목 | 수정 요구사항 |
|---|---|---|---|
| **P2-1** | `VoiceBar.tsx:411` | a11y 라벨 | `aria-label="마이크 장치 선택"` 추가. |
| **P2-2** | `voiceStore.ts:679` | 트랙 정리 타이밍 문서화 | `replaceInput` 성공 후에만 `stop()` 주석. |
| **P2-3** | `voiceStore.ts:19` | `LS_*` 네이밍 일관성 | `talklite_audio_device_id` 규칙 문서화. |

---

## 4. 검증 기준 (DoD) — refiner 인계

- [ ] **P0-1~P0-3** 드롭다운 선택이 `selectedAudioDeviceId` 에 유지되고 새로고침 후에도 유지, 분리된 장치 선택 시 `ideal` 폴백으로 기본 장치로 전환·토스트 노출
- [ ] **P0-4** 단순 스왑 후: OFF 시 `source→inputGain` 1간선, ON 시 `source→worklet→inputGain` 1간선 — `chrome://webaudio` 또는 `getNoiseSuppressionState()` 로 토글 5회 반복 시 간선 수·음성 왜곡 없음. OFF→ON(동일 모델) 재활성 시 Worklet에 신호 도달
- [ ] **P0-5** `attachRemote` 후 `suspended`·`deafened` 상태에서도 원격 음성 재생 — `masterGain` 0 해제 시 즉시 복구, `peerMutes` 토글 시 볼륨 재적용
- [ ] **P1** 단일 장치·핫플러그·권한 차단 시 목록 갱신 및 에러 세분화
- [ ] `npm run lint` 0 error, `npm run build` PASS (62 modules)

---

## 5. 부록 — 증거 로그

- `VoiceBar.tsx:412 value=""` — Controlled 고정, `VoiceBar.tsx:415 e.target.value=''`
- `voiceStore.ts:437 VoiceState` — `selectedAudioDeviceId` 미정의, `voiceStore.ts:675 exact`
- `voiceStore.ts:689 catch{}` — Silent Failure
- `voiceAudioEngine.ts:52-56` 2 Gain 필드, `voiceAudioEngine.ts:99-119` ensureContext 2 Gain 사전 생성, `voiceAudioEngine.ts:414-526` `needsNewNode/needsRewire` 80줄 중복
- `voiceAudioEngine.ts:276-304 attachRemote` — `suspended` 무대응, `voiceStore.ts:203` 플래그만 세움
- `webrtc.ts:98-112 replaceLocalStream` — 송신측 `replaceTrack`, `voiceAudioEngine.ts:255-274 replaceInput` — `destination` 불변으로 동일 `MediaStream` 유지 (단순 스왑 후에도 불변)

> 본 보고서는 `reviewer` 전담으로 **코드를 직접 수정하지 않고** 분석·문서화만 수행함. 모든 수정은 `refiner`(`w1J:p5`)가 본 문서의 Action Items를 정독하여 수행해야 함.
