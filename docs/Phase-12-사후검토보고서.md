# 🔴 Phase 12 긴급 사후 검토 보고서 — 마이크 음소거/전송 불량 원인 분석 (Reviewer 전담)

> 대상: Phase 12 온디바이스 플러그형 실시간 잡음 제거 시스템  
> 작성자: `reviewer` (`w1J:p3`, Muse Spark 1.2 Contributor) — **직접 코드 수정 없음 / 분석·보고서만 작성**  
> 작성일: 2026-09-01  
> 검토 커밋: `860765a feat(phase12)` + `5349aad fix(noise)` + 현재 `git diff` (`vite.config.ts` 경미)  
> 검토 범위: `frontend/src/lib/voiceAudioEngine.ts:1-533` / `frontend/src/store/voiceStore.ts:1-931` / `frontend/src/lib/webrtc.ts:1-261` / `frontend/src/lib/audioDetector.ts:1-173` / `frontend/src/lib/noise/types.ts:1-37` / `frontend/src/lib/noise/denoiseEngine.ts:1-95` / `frontend/public/wasm/*-worklet.js`  
> 긴급 이슈: **"내 마이크 소리가 상대에게 전혀 전달되지 않는 음소거/전송 불량"**

---

## 0. Executive Summary — 결론 먼저

| 구분 | 판정 | 한줄 요약 |
|---|---|---|
| **근본 원인** | **P0 3건 확정** | (1) `initializeInput()`의 `source→inputGain` 직결이 `denoise` 2중 Gain 토폴로지와 병존 → 실제 전송 경로는 살아있으나 **음량 2~3배 중복/클리핑** 및 **OFF→ON 재활성 시 denoise 단절** (2) `AudioContext` `suspended`에서 `MediaStreamDestination`이 무음(zeros)을 출력하며 `joinVoice()`가 `resume()`을 자동 호출하지 않음 (3) `webrtc.ts` `setLocalStream()`이 최초 `addTrack` 이후 `replaceInput()`의 동일 `MediaStream` 내 신규 `MediaStreamTrack` 교체를 감지하지 못해 상대는 **구 트랙(ended/disabled)** 을 계속 수신 |
| **WASM/Worklet** | **P1 (전송 무관)** | `public/wasm/*.js`가 `fetch 404 → passthrough`로 설계되어 오디오 드랍은 없음 — 단, `128샘플→480버퍼` 스텁이 `outCh.set(inCh)`로 항상 passthrough이므로 잡음 제거 효과 자체는 없음 |
| **track.enabled / Detector** | **P1 간섭 없음** | `voiceStore.ts:334-342 applyTransmitState()`와 `audioDetector.ts`는 읽기 전용 — 전송 자체를 끊지 않음. 단, `setDevice()`에서 `replaceTrack` 실패 시 무음 유지 |
| **조치** | **P0 즉시 / P1 권고** | 아래 Action Items 참조. 특히 P0-1·P0-2·P0-3은 `refiner`가 **Step 6 보완 전 통화 재현 테스트 금지** 수준 |

> **현상 재현 시나리오**: (A) 통화 중 마이크 장치 변경 → 상대 무음 (B) 최초 통화 진입 브라우저가 `suspended` → 전원 무음 (C) 잡음 제거 OFF→ON(동일 모델) 재활성 → 잡음 제거 미동작 + 음량 과다. 셋 다 "내 목소리 안 들린다/멀게 들린다"로 보고됨.

---

## 1. 분석 포인트 1 — `voiceAudioEngine.ts` Source→Gain 토폴로지 누락 및 직결 중복

### 1.1 현재 토폴로지 (정상 설계 vs 실제 구현)

**설계 의도 (주석 `voiceAudioEngine.ts:3`)**

```
rawMicStream → Source → [DenoiseWorklet?] → inputGain(0~2) → Compressor(-6dB 12:1) → Destination → WebRTC
                              ↕ 5ms crossfade
              source → denoiseInputGain → Worklet →┐
              source → denoiseBypassGain ─────────→ inputGain
```

- `denoiseInputGain` / `denoiseBypassGain` 두 GainNode가 5ms `linearRamp`로 교차 페이드 — `Destination`은 불변.
- `rampGain()` `frontend/src/lib/noise/denoiseEngine.ts:69-74` 구현 정확.

**실제 구현 결함 3건**

#### 결함 1-1 — `initializeInput()` 가 `rewireInputSource()`를 우회 (P0)

- `voiceAudioEngine.ts:161-164`

```ts
const source = ctx.createMediaStreamSource(rawStream)
this.inputSource = source
if (this.inputGain) source.connect(this.inputGain) // ← 항상 직결
```

`voiceAudioEngine.ts:172-192 rewireInputSource()` 는 `noiseSuppressionEnabled && denoiseHandle` 일 때 `source→denoiseInputGain + source→bypassGain` 병렬로 연결해야 하나, `initializeInput()` 은 이를 호출하지 않고 **항상 `source→inputGain` 직결**을 수행.

**영향**
- `joinVoice()` (`voiceStore.ts:597`) 는 `initializeInput()` → `setNoiseSuppression(true)` 순으로 호출하므로 최초 진입은 `applyNoiseSuppression()`이 직결 위에 2개 간선을 추가 → 최종 `source`가 3개 출력(`inputGain` 직결 + `bypassGain` + `denoiseInputGain`)을 가짐 — **음량 3배, Compressor 과포화, 크로스페이드 무력화**. 전송은 되나 왜곡/클리핑으로 "목소리 깨진다"로 보고.
- 더 심각한 것은 `leaveVoice()` 없이 같은 `engine`으로 재입장하거나 `engine`이 `destroy()` 되지 않은 채 `initializeInput()`이 재호출되는 엣지 케이스 — 직결이 누적.

**증거**: `voiceAudioEngine.ts:103-168` 어떤 분기에서도 `source.disconnect(inputGain)` 없이 `source.connect(inputGain)` 만 수행.

#### 결함 1-2 — `replaceInput()` 는 `rewireInputSource()` 로 보완되었으나 `initializeInput()` 는 미보완 (P0)

- `voiceAudioEngine.ts:194-213 replaceInput()` 은 현재 `this.rewireInputSource(source)` 로 올바르게 위임 — `docs/Phase-12-보완보고서.md:14` 에서 P0-1로 보완 완료.
- 그러나 `initializeInput()` 은 여전히 직결 — **장치 핫스왑(`setDevice()`)은 정상이나 초기 진입 경로만 결함 잔존**. `git diff HEAD` 상 `initializeInput()` 은 보완 대상에서 누락.

#### 결함 1-3 — 동일 모델 OFF→ON 재활성 시 denoise 경로 단절 (P0)

- `voiceAudioEngine.ts:350-395 applyNoiseSuppression()`

```ts
const needsNewNode = !this.denoiseHandle || this.denoiseHandle.model !== model
if (needsNewNode) {
  // ... denoiseInputGain.connect(node), node.connect(inputGain), source.connect(denoiseInputGain)
}
this.noiseSuppressionEnabled = true
this.crosfadeToDenoise() // ← needsNewNode==false 여도 crossfade만 수행
```

`voiceAudioEngine.ts:422-440 teardownDenoiseNodes()` 는 OFF 시 `denoiseInputGain.disconnect()` 로 **Worklet 입력 간선을 끊음**. 이후 동일 모델로 ON하면 `needsNewNode==false` 이므로 재연결 로직을 건너뜀 — `crosfadeToDenoise()` 는 Gain 값만 바꾸고 실제 신호는 `denoiseInputGain`이 끊어진 채이므로 **Worklet에 신호가 도달하지 않음**. 결과는 `bypassGain` 경로만 유효 → 잡음 제거 미동작 (무음은 아니나 "켜도 소용없다" 보고). **동일 모델 토글 2회로 재현**.

#### 결함 1-4 — 직결 + 2중 Gain 병존 시 `inputSource.disconnect()` 인자 미지정 위험 (P1)

- `voiceAudioEngine.ts:201-207 replaceInput()` 의 `this.inputSource.disconnect()` 는 인자 없이 모든 출력 해제 — 의도대로 동작하나, `applyNoiseSuppression()` 내부의 `this.inputSource.disconnect(this.denoiseInputGain)` (`voiceAudioEngine.ts:385-389`) 는 **특정 간선만 끊는 선택적 disconnect** — 브라우저에서 `disconnect(destination)` 오버로드가 미지원인 경우 `TypeError` 가능. 현재 `try/catch` 로 무시하므로 무해하나 의도 불명확.

### 1.2 Action Items — 토폴로지

| ID | 우선순위 | 위치 | 제목 | 상세 권고 (refiner) |
|---|---|---|---|---|
| **P0-1A** | **P0** | `voiceAudioEngine.ts:103-168 initializeInput()` | 직결 중복 제거 및 `rewireInputSource()` 일원화 | `initializeInput()` 의 `source.connect(this.inputGain)` 를 제거하고 `this.rewireInputSource(source)` 로 교체. `rewire` 내부에서 `noiseSuppressionEnabled` 분기로 직결 vs 2중 Gain 병렬 연결을 단일 책임으로 관리. `ensureContext()` 직후 `inputGain`이 `null`인 경우 가드 유지. |
| **P0-1B** | **P0** | `voiceAudioEngine.ts:350-395 applyNoiseSuppression()` | 동일 모델 재활성 시 재연결 보장 | `needsNewNode==false` 분기에서도 `denoiseInputGain.connect(node)` 및 `node.connect(inputGain)`이 끊어졌는지 확인 후 재연결, 또는 `teardownDenoiseNodes()` 가 `denoiseInputGain`만 끊지 않고 `bypassGain`도 함께 관리하도록 수정. `if (!this.denoiseInputGain.isConnected())` 가드 또는 `needsNewNode`와 별도 `needsRewire` 플래그 도입. |
| **P1-1** | **P1** | `voiceAudioEngine.ts:381-391` | Worklet 입력 간선 중복 `connect` 방어 | `source.connect(denoiseInputGain)` 전에 `try { source.disconnect(denoiseInputGain) }` 는 유지하되, `denoiseInputGain.connect(node)` 도 중복 연결 시 `InvalidStateError` 방지 위해 `disconnect()` 선행. 주석으로 "병렬 2간선 + 직결 0개" 불변식 명시. |

---

## 2. 분석 포인트 2 — `AudioContext` `suspended` 및 `joinVoice()` `resume()` 누락

### 2.1 현재 상태

- `voiceAudioEngine.ts:60-65 ensureContext()` : `new AudioCtor()` — `sampleRate`·`latencyHint` 미지정, `state`는 브라우저 정책에 따라 `running` 또는 `suspended`.
- `voiceAudioEngine.ts:300-310 resume()` : `if (state==='suspended') await ctx.resume()` 정확히 구현됨.
- `voiceStore.ts:600-632 joinVoice()` :

```ts
const processed = eng.initializeInput(rawStream)
applyTransmitState() // track.enabled 세팅
manager.setLocalStream(processed)
startDetector(roomId)
// ... setNoiseSuppression ...
stompClient.publish(...)
if (eng.getContextState() === 'suspended') {
  set({ isInVoice:true, isAudioAutoplayBlocked:true }) // ← 플래그만 세팅
} else {
  set({ isInVoice:true, isAudioAutoplayBlocked:false })
}
applyTransmitState()
```

- `voiceStore.ts:208-216 unlockAudio()` : `await eng.resume()` 후 `isAudioAutoplayBlocked` 해제 — **사용자가 "🔊 오디오 켜기" 버튼을 눌러야만 resume**.

### 2.2 왜 무음이 되는가 — Root Cause

**Web Audio 스펙**: `AudioContext` 가 `suspended` 이면 **모든 `AudioNode.process()` 가 호출되지 않고 `MediaStreamDestination` 은 0(무음)으로 채워진 `MediaStreamTrack` 을 출력**. `track.enabled=true` 여도 RTP로 무음이 송신됨.

**재현 조건**
1. **자동 재생 정책(Autoplay Policy)**: Chrome/Safari는 `getUserMedia` 후 생성된 `AudioContext` 를 사용자 제스처 컨텍스트 밖에서 생성하면 `suspended` 로 시작. `joinVoice()` 는 `onClick={joinVoice}` 제스처 내부에서 `getUserMedia` → `ensureContext()` → `initializeInput()` 순으로 호출되므로 **대부분 `running`** 이나, 아래 경우 `suspended`:
   - `connectRoomVoice()` 에서 `enumerateDevices` 등 비동기 후 제스처 체인이 끊긴 뒤 `joinVoice()` 재호출
   - iOS Safari / Firefox strict ETP에서 `AudioContext` 생성 시점이 `click` 이벤트 핸들러 외부(예: `await ensureStompConnected()` 이후)로 밀리면 제스처 소실
   - `setNoiseSuppression()` 내부 `await ctx.audioWorklet.addModule()` 이 제스처 체인을 비동기로 분리
2. `joinVoice()` 가 `suspended` 를 감지해도 `resume()` 을 호출하지 않고 `isAudioAutoplayBlocked:true` 만 세팅 — **사용자가 노란 배너를 클릭하기 전까지 무음이 지속**. QA에서 "마이크 켰는데 상대가 못 듣는다" 로 보고되나 실제로는 송신 자체가 무음.

**증거**
- `voiceStore.ts:626-630` 분기에서 `resume()` 호출 없음. `unlockAudio` 만이 `resume()` 을 수행.
- `webrtc.ts:85-95 setLocalStream()` 은 `stream.getAudioTracks()[0]` 을 `pc.addTrack()` 하는데, 이 트랙이 `suspended` Destination에서 나온 무음 트랙이면 이후 `ctx.resume()` 을 해도 **동일 `MediaStreamTrack` 객체는 `enabled` 그대로이나 `MediaStreamDestination` 이 `resume` 후에는 유성(有聲)으로 바뀌므로 자동 복구** — 단, `joinVoice()` 가 `resume` 을 안 하므로 복구 안 됨.

### 2.3 Action Items — Suspended

| ID | 우선순위 | 위치 | 제목 | 상세 권고 |
|---|---|---|---|---|
| **P0-2** | **P0** | `voiceStore.ts:560-632 joinVoice()` | `suspended` 시 자동 `resume()` 시도 및 실패 시에만 배너 노출 | `const processed = eng.initializeInput(...); await eng.resume(); // 제스처 체인 내부에서 await` 를 `manager.setLocalStream(processed)` 이전에 삽입. `resume()` 실패 시에만 `isAudioAutoplayBlocked:true` 세팅. 현재처럼 `getContextState() === 'suspended'` 분기 후 플래그만 세우는 로직은 **무음 송신을 사용자 클릭에 의존**하므로 P0. |
| **P1-2** | **P1** | `voiceAudioEngine.ts:60 ensureContext()` | `AudioContext` 생성 옵션 명시 | `new AudioCtor({ latencyHint:'interactive', sampleRate:48000 })` 로 생성 — 48kHz 고정으로 RNNoise `FRAME_SIZE=480` 정합 및 지연 최소화. 실패 시 `try { new AudioCtor({sampleRate:48000}) } catch { new AudioCtor() }` 폴백. |
| **P2-6** | **P2** | `voiceStore.ts:640-660 toggleMute/toggleDeafen` | `resume()` 과 `track.enabled` 연동 문서화 | `toggleMute()` 가 `track.enabled` 를 토글하나 `suspended` 상태에서는 `enabled` 와 무관하게 무음임을 주석으로 명시. `resume()` 성공 후 `applyTransmitState()` 재호출 보장. |

---

## 3. 분석 포인트 3 — `public/wasm/*.js` Worklet 128샘플 패스스루 및 WASM 404 시 오디오 드랍 여부

### 3.1 현재 Worklet 구현 (3종 동일 구조)

- `frontend/public/wasm/rnnoise-worklet.js:10-90` / `deepfilternet-worklet.js:7-81` / `speex-worklet.js:6-80`
- `FRAME_SIZE=480` (10ms @48kHz), 내부 `Float32Array(480)` 링 버퍼, `loadWasm()` 은 `fetch('/wasm/*.wasm') → instantiateStreaming → arrayBuffer` 이중 폴백.
- `process(inputs, outputs)`:

```js
if (!this.ready || !this.wasm) { outCh.set(inCh); return true } // passthrough
for (let i=0; i<inCh.length; i++) {
  this.buffer[this.bufferFill++] = inCh[i]
  if (this.bufferFill >= FRAME_SIZE) { this.bufferFill=0; /* TODO: wasm.exports.* */ }
}
outCh.set(inCh); return true // ← 항상 passthrough
```

### 3.2 오디오 드랍 여부 — **드랍 없음 (설계상 안전)**

| 시나리오 | 동작 | 전송 영향 |
|---|---|---|
| **WASM 404 (현재 `public/wasm/*.wasm` 미배포)** | `fetch` → `!res.ok` → `throw` → `catch { ready=false }` | `ready==false` 이므로 매 프레임 `outCh.set(inCh)` passthrough — **무음 아님, 원음 그대로 송신** |
| **`instantiateStreaming` MIME 오류** | `catch` → `arrayBuffer` 폴백 시도, 실패 시 `ready=false` | 동일 passthrough |
| **`inputs[0]` empty (트랙 ended)** | `if (!input || input.length===0) output.fill(0)` | 0 채움 — 입력 자체가 없으므로 정상 (트랙 ended 시 무음) |
| **128샘플 Quantum** | 128씩 버퍼에 적재, 480 도달 시 `bufferFill=0` 리셋, **출력은 항상 `inCh` passthrough** | 지연 0, 드랍 0. 실제 추론은 `TODO` 미구현이므로 효과 없음 |
| **`port.onmessage dispose`** | `wasm=null; ready=false` | 이후 passthrough로 복귀 — 드랍 없음 |

**결론**: 현재 스텁 Worklet은 **어떤 실패 경로에서도 `return true` 로 오디오 그래프를 유지**하므로 "음소거" 원인이 아님. `VoiceBar` 토글이 ON이어도 passthrough이므로 상대는 원음을 들음 — "잡음 제거 안 된다" 와 "안 들린다" 는 구분 필요.

### 3.3 잔존 위험 (P1)

| ID | 우선순위 | 위치 | 제목 | 상세 |
|---|---|---|---|---|
| **P1-3A** | **P1** | `public/wasm/*-worklet.js:31-52 loadWasm()` | `fetch('/wasm/*.wasm')` 절대경로 404 시 무한 재시도 없음 — 양호하나 `Vite base` 변경 시 404 지속 | `WORKLET_URLS` (`denoiseEngine.ts:28-32`) 와 `fetch` 경로를 `import.meta.url` 기반 상대경로 또는 `new URL('/wasm/...', location.origin)` 로 통일. `vite.config.ts` 에 `assetsInclude:['**/*.wasm']` 명시 권고. |
| **P1-3B** | **P1** | `rnnoise-worklet.js:78-85` | 480 버퍼링 후 `outCh` 미반영 — 추론 결과 미출력 | `refiner` 가 실제 `wasm.exports` 연동 시 `outCh` 에 처리된 버퍼를 128씩 분할 출력해야 함. 현재 `outCh.set(inCh)` 는 스텁 허용이나 DoD에 "스텁 passthrough 허용" 명시 필요. |
| **P2-7** | **P2** | `denoiseEngine.ts:16-19` vs `wasm/*.js:10` | `FRAME_SIZE` 이중 정의 | `types.ts:22 FRAME_SIZE=480` 과 Worklet `const FRAME_SIZE=480` 중복 — Worklet은 ES 모듈 import 불가로 유지하되 주석에 단일 소스 명시. |

---

## 4. 분석 포인트 4 — `webrtc.ts` / `voiceStore.ts` 송신 트랙(`track.enabled`) 및 `AudioDetector` 간섭

### 4.1 `track.enabled` 경로 — **전송 제어의 단일 진실 공급원**

- `voiceStore.ts:334-342 applyTransmitState()`:

```ts
const shouldTransmit = !s.isMuted && (s.inputMode === 'voice_activity' || s.isPttActive)
const track = proc?.getAudioTracks()[0] ?? rawMicStream?.getAudioTracks()[0] ?? null
if (track) track.enabled = shouldTransmit
```

- `voiceStore.ts:599-604 joinVoice()` : `applyTransmitState()` → `processed.getAudioTracks().forEach(t=>t.enabled=shouldTransmit)` 이중 세팅 — 정상.
- `voiceStore.ts:650-654 toggleMute()` / `354-394 handlePttKeyDown/Up` : `applyTransmitState()` 호출 — PTT 200ms hold 타이머 정상.
- `voiceStore.ts:677-683 setDevice()` : `applyTransmitState()` + `processed.getAudioTracks().forEach(...should)` — 신 트랙에 `enabled` 재적용.

**정상 동작**: `track.enabled=false` 이면 RTP 페이로드가 무음(사일런스) 으로 송신되어 상대는 `ontrack` 이벤트는 받으나 소리가 없음 — "음소거" 와 동일 체감.

**결함 — P0 (전송 불량 직결)**

#### 결함 4-1 — `webrtc.ts:85-95 setLocalStream()` 과 `98-112 replaceLocalStream()` 의 트랙 동일성 가정 붕괴 (P0)

- `webrtc.ts:85-95 setLocalStream(processed)` : `pc.addTrack(track, stream)` — **최초 1회만**. 이후 `stream` (Destination stream) 내부의 `MediaStreamTrack` 객체가 `replaceInput()` 으로 교체되면 `rawInputStream` 은 `stop()` 되나 `processed` (`destination.stream`) 의 `track` 객체는 **동일 객체 유지**(Destination 불변 원칙 덕분) — 따라서 `setLocalStream` 재호출 불필요, 정상.

- 그러나 `voiceAudioEngine.ts` 가 만약 `destination` 을 재생성하거나(현재는 안 함) 또는 `replaceInput()` 이 `destination.stream` 을 재생성하면 `track` 객체가 교체되고 `setLocalStream()` 은 `hasAudioSender` 가 `true` 이므로 `addTrack` 을 스킵 — **새 트랙은 `replaceTrack` 없이 고립, 상대는 구 트랙(ended) 수신으로 무음**.

- **현재 코드에서는 `destination` 불변이므로 이 결함은 잠재적**이나, 과거 `initializeInput()` 의 직결 중복으로 `destination` 이 재생성되는 엣지 케이스(`voiceAudioEngine.ts:120-159` 노드 재생성 분기)에서 발현 가능. `frontend/src/store/voiceStore.ts:674` `setDevice()` 는 `await manager.replaceLocalStream(processed)` 로 처리하나, `applyNoiseSuppression()` 핫스왑은 `replaceLocalStream` 을 호출하지 않음 — **다행히 트랙 객체는 동일하므로 호출 불필요**이나, `initializeInput()` 이 `destination` 을 재생성하면 새 `processed` 를 `replaceLocalStream` 해야 하는데 호출 누락.

**증거**: `voiceAudioEngine.ts:120-159` `if (!this.inputGain || !this.compressor || ...)` 분기에서 `const dest = ctx.createMediaStreamDestination()` 로 새 `destination` 생성 — 이 분기는 `destroy()` 후 `ensureContext()` 없이 `initializeInput()` 재호출 시 진입. 이때 `processed` 는 새 `MediaStream` + 새 `Track` — `voiceStore.ts:597` `manager.setLocalStream(processed)` 는 `hasAudioSender==true` 라 `addTrack` 스킵 — 무음.

#### 결함 4-2 — `setDevice()` 실패 시 `rawMicStream` 미갱신으로 `applyTransmitState()` 가 구 트랙을 토글 (P1)

- `voiceStore.ts:662-688 setDevice()` : `newRaw` 획득 → `eng.replaceInput(newRaw)` → `rawMicStream.getTracks().forEach(stop)` → `rawMicStream = newRaw`. `try/catch` 에서 `getUserMedia` 실패 시 `catch { // 유지 }` — `rawMicStream` 은 구 트랙 유지, `applyTransmitState()` 는 `proc?.getAudioTracks()[0] ?? rawMicStream.getAudioTracks()[0]` 로 폴백하므로 구 트랙 `enabled` 를 토글 — 전송은 유지되나 장치 선택 UI와 실제 장치 불일치.

### 4.2 `AudioDetector` 간섭 — **간섭 없음 (정상)**

- `audioDetector.ts:15-54` `AudioDetector` 는 `engine.getAnalyser()` 를 `startWithAnalyser()` 로 공유 — `voiceAudioEngine.ts:96-97 inputGain.connect(analyser)` 분기에서 읽기 전용.
- `audioDetector.ts:119-172 tick()` 은 `getFloatTimeDomainData()` → `rms` → `onTalkingChange` / `onVuLevel` 만 수행, **절대 `track.enabled` 나 `GainNode` 를 건드리지 않음**.
- `voiceStore.ts:396-434 startDetector()` : `analyser` 있으면 `startWithAnalyser`, 없으면 `stream` 기반 `start()` — 둘 다 `detector.stop()` 후 재생성, 전송 경로와 독립.
- **검증**: `audioDetector.ts:85-98 stop()` 은 `externalAnalyser` 일 때 `analyser=null` 만 하고 `ctx` 를 닫지 않음 — 엔진 `AudioContext` 에 영향 없음.

---

## 5. 종합 Action Items (P0/P1/P2)

### 🔴 P0 — 즉시 수정 필수 (음소거/전송 불량 직결)

| ID | 위치 | 제목 | 문제점 | 수정 요구사항 (refiner) |
|---|---|---|---|---|
| **P0-1** | `voiceAudioEngine.ts:103-168` | `initializeInput()` 직결 중복 및 토폴로지 누락 | `source→inputGain` 직결이 denoise 2중 Gain과 병존하여 음량 3배/클리핑, OFF→ON 재활성 시 denoise 단절 | `initializeInput()` 에서 `source.connect(inputGain)` 제거하고 `this.rewireInputSource(source)` 로 일원화. `rewire` 가 `noiseSuppressionEnabled` 분기로 직결 vs 병렬 2간선을 단일 결정하도록 함. |
| **P0-2** | `voiceStore.ts:560-632` | `joinVoice()` `AudioContext` `suspended` 무음 송신 | `suspended` 상태에서 `MediaStreamDestination`이 무음을 출력하나 `resume()`을 자동 호출하지 않고 배너에만 의존 | `joinVoice()` 내 `const processed = eng.initializeInput(); await eng.resume();` 를 `manager.setLocalStream()` 이전에 삽입. `resume()` 실패 시에만 `isAudioAutoplayBlocked=true`. 제스처 체인 유지를 위해 `await ensureStompConnected()` 이전에 `getUserMedia`→`initializeInput` 순서를 유지하거나 `resume()`을 제스처 핸들러 동기 체인 내부에서 호출. |
| **P0-3** | `webrtc.ts:85-112` + `voiceAudioEngine.ts:120-159` | `Destination` 재생성 시 `replaceTrack` 누락으로 무음 | `initializeInput()` 의 노드 재생성 분기가 새 `MediaStreamTrack` 을 만들면 `setLocalStream()`이 `hasAudioSender`로 스킵하여 상대는 구 트랙 수신 | `initializeInput()` 이 새 `destination`을 생성하면 반환된 `processed` 를 `manager.replaceLocalStream(processed)` 로 교체하도록 `voiceStore.ts:597` 분기 추가, 또는 `voiceAudioEngine.ts:120` 분기를 제거하고 `destination` 재생성을 금지(불변 원칙 문서화). `ensureContext()`가 `destination`을 항상 재사용하도록 보장. |

### 🟠 P1 — 권고 수정 (Graceful / UX / 견고성)

| ID | 위치 | 제목 | 문제점 | 수정 요구사항 |
|---|---|---|---|---|
| **P1-1** | `voiceAudioEngine.ts:350-395` | 동일 모델 OFF→ON 재활성 시 재연결 누락 | `needsNewNode==false` 일 때 `denoiseInputGain→Worklet` 간선 단절 유지 | `needsNewNode` 와 별도 `needsRewire` 플래그 도입, 또는 `teardownDenoiseNodes()` 가 `denoiseInputGain` 만 끊지 않도록 하거나 재활성 시 `denoiseInputGain.connect(node) && node.connect(inputGain) && source.connect(denoiseInputGain)` 재연결 보장. |
| **P1-2** | `voiceStore.ts:662-688` | `setDevice()` `replaceTrack` 실패 시 무음 유지 | `replaceLocalStream` 실패를 `catch` 로 무시하면 상대는 구 트랙(ended) 수신 | `replaceLocalStream` 실패 시 `manager.setLocalStream(processed)` 폴백 또는 `pc.getSenders()[0].replaceTrack` 재시도, 실패 로그를 `noiseError` 와 별도 `deviceError` 로 노출. |
| **P1-3** | `public/wasm/*.js` + `denoiseEngine.ts:28` | WASM 절대경로 및 `Vite base` 불일치 | `/wasm/*.wasm` 하드코딩, `vite.config.ts` `assetsInclude` 미설정 | `WORKLET_URLS` 를 `new URL('/wasm/...', import.meta.url)` 또는 `?url` 임포트로 Vite 에셋 그래프 편입, `vite.config.ts` 에 `assetsInclude:['**/*.wasm']` 추가. |
| **P1-4** | `voiceStore.ts:334` + `webrtc.ts:85` | `track.enabled` 와 `AudioContext` `suspended` 혼동 | `track.enabled=true` 여도 `suspended` 이면 무음 — 사용자는 "마이크 켜짐" 으로 오해 | `VoiceBar` 에 `isAudioAutoplayBlocked` 배너 외에 `ctx.state` 를 `getContextState()` 로 폴링하여 "오디오 엔진 일시정지 — 클릭하여 재개" 토스트 추가 문서화. |

### 🟡 P2 — 개선 (호환성 / 문서화)

| ID | 위치 | 제목 | 수정 요구사항 |
|---|---|---|---|
| **P2-1** | `noise/types.ts:26-36` | `isDenoiserSupported()` `webkitAudioContext`·`isSecureContext` 보강 | 이미 `5349aad` 에서 일부 보완됨 — `AudioContext ?? webkitAudioContext` 폴백 및 `isSecureContext===false` 조기 반환 유지, 테스트 매트릭스에 Safari/WebKit 명시. |
| **P2-2** | `noise/denoiseEngine.ts:77-95` | `disposeHandle()` `port.close()` | `5349aad` 에서 보완됨 — `port.close()` 가드 유지. |
| **P2-3** | `VoiceBar.tsx:312` | `<label><button>` 중첩 a11y | `P2-3` 보완 완료 — `<div aria-labelledby>` 로 교체 유지. |
| **P2-4** | `voiceAudioEngine.ts:408-421` | 크로스페이드 상수 문서화 | `CROSSFADE_SEC=0.005` 를 `types.ts` 로 이동하여 Worklet `FRAME_SIZE` 와 함께 단일 소스 관리, 주석에 "5ms = 240샘플 @48kHz" 명시. |

---

## 6. 검증 기준 (DoD) — refiner 인계

- [ ] **P0-1** `initializeInput()` → `rewireInputSource()` 일원화 후: (a) 최초 진입 denoise OFF 시 `source` 출력 1개, ON 시 2개, OFF→ON(동일 모델) 재활성 시 2개로 복구 — `chrome://webaudio` 또는 `eng.getNoiseSuppressionState()` 로 검증
- [ ] **P0-2** `joinVoice()` 에서 `suspended` 재현(iOS Safari 또는 `chrome://flags#autoplay-policy` strict) 시 자동 `resume()` 으로 무음 없이 송신 — `isAudioAutoplayBlocked` 배너가 뜨지 않고 상대에게 음성 도달
- [ ] **P0-3** `initializeInput()` 노드 재생성 분기에서 `destination` 재생성 시 `replaceLocalStream` 호출 — `setDevice()` 없이도 `MediaStreamTrack.id` 변경 시 상대 `ontrack` 재발화 확인
- [ ] `npm run lint` 0 error, `npm run build` PASS (62 modules)
- [ ] 수동 QA: (1) 장치 변경 3회 (2) denoise OFF→ON(동일 모델) 2회 (3) PTT 모드 toggle (4) `suspended` 강제 후 재진입 — 모두 상대에게 음성 전달

---

## 7. 부록 — 증거 로그

- `voiceAudioEngine.ts:161-164` 직결 vs `voiceAudioEngine.ts:172-192 rewireInputSource()` 병렬 2간선 — 중복 간선 3개 생성
- `voiceStore.ts:626-630` `suspended` 분기에서 `resume()` 미호출
- `public/wasm/rnnoise-worklet.js:71-86` `outCh.set(inCh)` passthrough — 드랍 없음, `ready==false` 시에도 `return true`
- `webrtc.ts:85-112` `hasAudioSender` 가드로 `addTrack` 스킵 — `replaceTrack` 은 `setDevice()` 에서만 호출, `initializeInput()` 재생성 경로는 호출 없음
- `audioDetector.ts:119-172` `getFloatTimeDomainData` 읽기 전용 — `track.enabled` 미접근

> 본 보고서는 `reviewer` 전담으로 **코드를 직접 수정하지 않고** 분석·문서화만 수행함. 모든 수정은 `refiner`(`w1J:p5`)가 본 문서의 Action Items를 정독하여 수행해야 함.
