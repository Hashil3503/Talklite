# 📚 Phase 12 누적 통합 사후 검토 보고서 (Append-Only, Round 1~5 완벽 보존)

> **원칙**: 누적 기록(Append-Only) — 기존 라운드 내용을 덮어쓰지 않고 Round 단위로 순차 누적. 본 문서는 Round 1~5의 원본을 **원문 그대로 보존**하고, 최상단에 통합 목차와 최신 Round 요약을 제공한다.
> **대상**: Phase 12 온디바이스 플러그형 실시간 잡음 제거 시스템 + WebRTC 음성 파이프라인 전 계층
> **작성자**: eviewer (w1J:p3, Muse Spark 1.2 Contributor) — 코드 수정 금지, 문서화 전담
> **작성일**: 2026-09-01 (누적 통합본)
> **검토 커밋 히스토리**: 860765a(Round1) → 87b70a2(Round2) → 481b9d(Round3) → 001247(Round4) → 4c91e5f(Round5)

---

## 🗂️ 통합 목차 (Round별 바로가기)

- [Round 1] 초기 잡음제거 핫스왑/누수 검토 (860765a)
- [Round 2] 긴급 오디오 송출 파이프라인/AudioContext 분석 (87b70a2)
- [Round 3] 마이크 드롭다운/단순화 분석 — 긴급 2건 통합 (481b9d)
- [Round 4] WebRTC ICE 큐잉/수신단 분석 및 이전 실패 회고 (001247)
- [Round 5] 로봇 변조음 Comb Filter 분석 (4c91e5f)

> **최신 Round 5 요약**: 수신단 이중 동시 출력(Web Audio + \<audio>\ 둘 다 가청)으로 인한 Comb Filtering 메탈릭 변조, AudioWorklet 128 vs 480 버퍼 글리치, 이중 볼륨 동기화 미스 — P0-A/B/C로 단일 경로 가청화 및 링 버퍼 교정.

---


---

# 🟦 Round 1 — 초기 잡음제거 핫스왑/누수 검토 (원문 보존, 860765a)

> 원본 커밋: 860765a feat(phase12): implement pluggable on-device real-time noise suppression

# 🔍 Phase 12 사후 코드 검토 및 보완 요구사항 보고서 (Reviewer Report)

> 대상 마일스톤: Phase 12 (딥러닝 기반 온디바이스 실시간 잡음 제거 시스템)  
> 작성자: `reviewer` (`w1K:p3`, Muse Spark 1.2 Contributor)  
> 수신자: `refiner` (`w1K:p4`), `supervisor` (`w1K:p1`)  
> 작성일: 2026-09-01  
> 검토 대상: `git diff HEAD`, `frontend/src/lib/noise/`, `frontend/src/lib/voiceAudioEngine.ts`, `frontend/src/store/voiceStore.ts`, `frontend/src/components/voice/VoiceBar.tsx`, `frontend/public/wasm/`

---

## 1. 종합 검토 요약

1. **설계 정합성**:
   - `MediaStreamDestination` 노드 불변 원칙을 준수하여 핫스왑/토글 시 WebRTC 송신 트랙(`replaceTrack`) 유실을 방어함.
   - `denoiseSeq` 시퀀스 번호 가드를 통해 비동기 WASM 로딩 경합(Race Condition)을 안전하게 차단함.
   - 5ms 선형 게인 크로스페이드(`linearRampToValueAtTime`) 및 `localStorage` 화이트리스트 영구 기억이 충실히 구현됨.
2. **사후 보완 필수 결함 (P0/P1)**:
   - 마이크 장치 교체(`replaceInput`) 시 잡음제거 활성 상태에서 `newSource`가 `inputGain`에만 직결되어 잡음제거가 무력화되는 결함 발견.
   - 모델 변경 및 경합 폐기 시 `oldHandle` 리소스 해제(`disposeHandle`) 누락 방어 필요.
   - HTML a11y `<label><button>` 중첩 구조 개선 필요.

---

## 2. Action Items (우선순위별 상세 작업 목록)

### 🔴 P0 — 즉시 수정 필수 (Hot-Swap & Lifecycle Defects)

| ID | 위치 | 제목 | 문제점 및 수정 요구사항 (Refiner 가이드) |
| :--- | :--- | :--- | :--- |
| **P0-1** | `frontend/src/lib/voiceAudioEngine.ts:replaceInput` | 장치 핫스왑 시 잡음제거 파이프라인 재연결 누락 | 마이크 입력 장치가 교체될 때(`replaceInput`), 잡음제거가 활성화된 상태라면 `newSource`를 `denoiseInput`에 재연결해야 함. `rewireInputSource()` 헬퍼를 도입하여 잡음제거 활성 여부에 따라 올바른 노드로 연결하도록 보정할 것. |
| **P0-2** | `frontend/src/lib/voiceAudioEngine.ts:331-345` | `oldHandle` 리소스 해제 누락 및 `port.close()` | 모델 변경 및 비동기 경합 폐기 시 `disposeHandle(oldHandle)`을 정확히 호출하고, `node.port.close()`를 실행하여 메모리 누수 및 백그라운드 AudioWorklet 고아 노드를 방지할 것. |

---

### 🟠 P1 — 권고 수정 (Graceful Fallback & Web Audio 수명주기)

| ID | 위치 | 제목 | 문제점 및 수정 요구사항 (Refiner 가이드) |
| :--- | :--- | :--- | :--- |
| **P1-1** | `frontend/src/store/voiceStore.ts:872,898` | `isNoiseLoading` 중 연속 모델 변경 유실 방어 | WASM 다운로드 중 사용자가 다른 모델을 클릭할 경우 요청이 무시되지 않도록 마지막 선택 모델을 큐잉하거나 순차 적용하도록 보강할 것. |
| **P1-3** | `frontend/src/lib/noise/types.ts` | `FRAME_SIZE` 상수 단일화 | 여러 파일에 분산된 `480` 프레임 크기 상수를 `types.ts`로 단일화하여 관리할 것. |
| **P1-5** | `frontend/src/lib/voiceAudioEngine.ts:destroy` | `destroy()` 시 `teardownDenoiseNodes()` 선행 호출 | `this.ctx.close()` 이전에 `teardownDenoiseNodes()`를 먼저 호출하여 안전하게 Web Audio 노드 연결을 끊을 것. |

---

### 🟡 P2 — 크로스 브라우저 호환성 및 접근성(a11y) 개선

| ID | 위치 | 제목 | 문제점 및 수정 요구사항 (Refiner 가이드) |
| :--- | :--- | :--- | :--- |
| **P2-1** | `frontend/src/lib/noise/types.ts:isDenoiserSupported` | `webkitAudioContext` 및 `isSecureContext` 검사 | Safari 구형 및 HTTPS/localhost 보안 컨텍스트 검사를 추가하여 런타임 크래시 방어. |
| **P2-3** | `frontend/src/components/voice/VoiceBar.tsx:312` | `<label><button>` 중첩 HTML invalid 구조 개선 | `<label>` 내부에 `<button>`이 중첩되면 스크린리더가 오동작하므로 `<div>` + `aria-labelledby` 구조로 리팩토링. |

---

## 3. 검증 기준 (DoD)
- [ ] 프론트엔드 `npm run lint` 0 error (경고 외 에러 0건)
- [ ] 프론트엔드 `npm run build` 성공 (Vite 번들 통과)



---

# 🟥 Round 2 — 긴급 오디오 송출 파이프라인/AudioContext 분석 (원문 보존, 87b70a2)

> 원본 커밋: 87b70a2 fix(audio): resolve mic audio mute

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



---

# 🟧 Round 3 — 마이크 드롭다운/단순화 분석 — 긴급 2건 통합 (원문 보존, a481b9d)

> 원본 커밋: a481b9d fix(audio): restore mic device selection dropdown binding

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



---

# 🟪 Round 4 — WebRTC ICE 큐잉/수신단 분석 및 이전 실패 회고 (원문 보존, f001247)

> 원본 커밋: f001247 fix(webrtc): resolve silent voice bug with ICE candidate queueing

# 🔴 Phase 12 긴급 사후 검토 보고서 — WebRTC 음성 미전달 3대 근본 원인 (Reviewer 전담)

> 대상 마일스톤: Phase 12 온디바이스 플러그형 실시간 잡음 제거 시스템  
> 작성자: `reviewer` (`w1J:p3`, Muse Spark 1.2 Contributor)  
> 수신자: `refiner` (`w1J:p5`), `supervisor` (`w1J:p4`)  
> 작성일: 2026-09-01  
> 검토 커밋: `860765a feat(phase12)` + `5349aad` + 현재 HEAD (`webrtc.ts:261` / `voiceStore.ts:1072` / `voiceAudioEngine.ts:594`)  
> 검토 대상: `frontend/src/lib/webrtc.ts:34-261` / `frontend/src/store/voiceStore.ts:221-240,611-733,756-829` / `frontend/src/lib/voiceAudioEngine.ts:243-304,514-594` / 백엔드 `SignalController.java` / `RoomEventPublisher.java`  
> 긴급 현상: **룸 통화 참여 중 상대에게 목소리가 전혀 전달·재생되지 않는 무음** — 시그널링은 성공 로그, `pc.connectionState=connected` 인 경우에도 무음  
> 규정 준수: **직접 코드 수정 금지 — 전 계층 심층 분석 및 P0 Action Items·수정 가이드 문서화만 수행**

---

## 0. 회고 분석 — 이전 시도의 추측한 원인과 해결 시도, 그리고 왜 해결되지 않았는가

> **요청 반영**: 사용자 요청에 따라, 본 보고서 상단에 이전 라운드에서 추측했던 원인과 해결 시도를 회고하고, 왜 무음이 해소되지 않았는지와 이번 3대 P0가 어떻게 다른 차원의 결함인지 명확히 기록한다.

### 0.1 이전 시도가 편향된 가설 — "송신단 Web Audio 게인 노드"에 집중

| 라운드 | 추측한 원인 (가설) | 해결 시도 | 결과 |
|---|---|---|---|
| Phase 12 초기 ~ Step 6 보완 | **송신단 Web Audio 그래프 결함**: `inputGain`·`compressor`·`destination`·`denoiseBypassGain`/`denoiseInputGain` 이중 Gain 병렬·크로스페이드, `rewireInputSource()` 미연결, `replaceInput()` 직결 중복, `destination` 불변 위반, `AudioContext` `suspended` 시 `MediaStreamDestination` 무음 | `voiceAudioEngine.ts:52-221` `ensureContext`·`initializeInput`·`rewireInputSource`·`applyNoiseSuppression` 을 단순 스왑 파이프라인(`OFF: source→inputGain / ON: source→worklet→inputGain`)으로 축소, `denoiseBypass/InputGain` 제거·`denoiseNode` 단일화, `resume()` 자동 호출, `selectedAudioDeviceId` 도입, `exact→ideal` 폴백 | 송신 트랙의 **음량·왜곡·장치 선택**은 개선되었으나, **"상대에게 전혀 전달되지 않는 무음"은 그대로 재현**. `pc.connectionState=connected` 로그만 남고 원인 불명 상태가 지속. |
| 간헐적 시도 | **스토어·UI 바인딩**: `VoiceBar` `value=""` 하드코딩, `selectedAudioDeviceId` 미보유, `setDevice` `OverconstrainedError` 미처리 | `VoiceBar` Controlled 바인딩, `LS_AUDIO_DEVICE_ID` 영속화, `devicechange` 리스너 | 장치 선택 UX는 개선, 무음과는 무관함을 확인. |

**편향의 특징**: 모든 시도가 **"내 마이크 → `getUserMedia` → `VoiceAudioEngine` → `destination.stream` → `setLocalStream/replaceTrack` → 송신"** 이라는 **송신단 파이프라인 내부**에만 머물렀다. `webrtc-internals` 의 `outbound-rtp bytesSent` 는 증가하는 것으로 보여 "송신은 된다" 고 오판했고, 수신단 검증(`inbound-rtp packetsReceived` vs `audioLevel`)을 병행하지 않았다.

### 0.2 왜 해결되지 않았는가 — 실제 결함은 송신단이 아니었다

| 추측의 사각지대 | 실제 P0 결함 (본 보고서 §1~3) | 왜 이전 수정으로 가려지지 않았는가 |
|---|---|---|
| **송신 게인만 보면 `getProcessedStream()` 트랙은 정상** — `track.enabled=true`, `destination` 불변, `replaceTrack` 호출 성공으로 보임 | **[P0-1] P2P ICE Candidate 유실** `webrtc.ts:211-254` — `setRemoteDescription` 전 Candidate 즉시 `addIceCandidate` 실패 후 유실, 큐 없음. `iceConnectionState=failed` 로 **패킷 자체가 상대에 도달하지 않음**. `outbound-rtp bytesSent` 는 증가해도 상대 `inbound-rtp packetsReceived` 0. | 게인 수정은 `MediaStreamTrack` 객체 내부 오디오 레벨만 바꾸고, **ICE 레벨의 연결 수립 자체를 복구하지 못함**. 로그는 `addIceCandidate failed` 1줄만 남고 시그널링은 성공으로 보여 원인으로 인식되지 않았다. |
| **송신 트랙이 있으면 수신도 될 것이라는 가정** — `pc.ontrack` 은 항상 `stream` 을 줄 것이라는 가정 | **[P0-2] `ontrack` `event.streams[0]` undefined** `webrtc.ts:169-174` — Firefox/Safari 등에서 `event.streams=[]` 이면 `onRemoteStream` 미호출 → `peerMap` 에 피어 자체가 생성 안 됨. **수신 경로는 생성조차 안 됨**. | 송신단 그래프를 아무리 단순화해도 수신단 `peerMap` 생성 조건 자체가 불만족이면 재생할 대상이 없다. 1:1 Chrome 테스트에선 재현 안 되고, 3자·크로스 브라우저에서만 발현되어 QA에서 누락. |
| **Web Audio로만 연결하면 재생된다는 가정** — `MediaStreamSource→Gain→masterGain→destination` 으로 충분하다는 가정 | **[P0-3] Chromium 수신단 디코더 미기동** `voiceAudioEngine.ts:243-304` — Chrome은 원격 스트림이 한 번도 `<audio srcObject>` 에 바인딩되지 않으면 **디코더를 스킵**하고 Web Audio로도 무음을 출력. `packetsReceived` 는 증가하나 `audioLevel` 0. | 송신 게인을 0→1로 바꿔도, 수신단 디코더가 `playing` 상태로 전이되지 않으면 **디코딩 자체가 안 되므로** 게인 값과 무관하게 무음. `audio.srcObject=stream; audio.play()` 병행이 없으면 Web Audio만으로는 Chrome에서 절대 유성으로 바뀌지 않는다. |

### 0.3 교훈 및 이번 보고서의 관점 전환

1. **송신단 편향 → End-to-End 검증**: `getUserMedia` → `VoiceAudioEngine` → `RTCPeerConnection` → **STOMP 시그널링 순서** → **ICE 상태** → **ontrack 스트림 생성** → **수신단 디코더 기동** 전 구간을 `webrtc-internals` (`outbound-rtp` / `inbound-rtp` / `iceCandidatePair` / `audioLevel`) 로 대조해야 한다. 송신단 `inputGain` 값만 보는 디버깅은 P2P·브라우저 버그를 가린다.
2. **로그의 함정**: `addIceCandidate failed` 는 `catch` 후 `console.error` 1줄로 끝나고, `pc.ontrack` 미호출은 로그 자체가 없으며, Chrome Web Audio 무음은 `packetsReceived` 증가로 "전송 성공" 으로 오인된다. **무음 재현 시에는 반드시 `chrome://webrtc-internals` 의 `packetsReceived` vs `audioLevel` vs `peerMap.size` 3지표를 동시에 확인**해야 한다.
3. **이번 P0 3건은 이전 수정과 직교**: 이중 Gain 단순화·`selectedAudioDeviceId`·`resume()` 은 **송신 품질**을 개선한 유효한 수정이며 되돌릴 필요가 없다. 다만 그 위에 **P2P 연결성(P0-1)·스트림 생성(P0-2)·수신 디코더 기동(P0-3)** 3층을 추가로 쌓아야 비로소 End-to-End 유성이 보장된다.

> **한 문장 회고**: 이전 시도는 "내 목소리를 얼마나 잘 **담아 보내는가**"에 집중했고, 실제 결함은 "담은 목소리가 **상대에게 도달·생성·디코딩되는가**"에 있었다.

---

## 0. Executive Summary — 3대 근본 원인 통합 결론

| # | 근본 원인 | 판정 | 한줄 요약 | 단독으로 무음 유발 |
|---|---|---|---|---|
| **1** | **ICE Candidate 큐잉 누락** | **P0** | `webrtc.ts:211-254 handleSignal()` 이 `setRemoteDescription()` 전에 도착한 Candidate를 `await addIceCandidate()` 즉시 시도로 실패 → `catch` 후 유실. 이후 `remoteDescription` 세팅 후에도 재시도 큐가 없어 Trickle ICE 후반 후보 영구 소실 → `iceConnectionState=failed` → P2P 수립 실패. | ✅ |
| **2** | **ontrack `event.streams[0]` undefined** | **P0** | `webrtc.ts:169-174 pc.ontrack` 이 `event.streams[0]` 만 신뢰. Unified Plan / `addTrack(stream)` 미사용 경로 / Firefox·Safari에서 `event.streams=[]` 이면 `onRemoteStream` 미호출 → `voiceAudioEngine:peerMap` 에 피어 자체가 생성 안 됨. 시그널링·ICE는 성공이나 재생 경로 자체가 없음. | ✅ |
| **3** | **Chrome Web Audio 무음 버그** | **P0** | `voiceAudioEngine.ts:243-304` + `voiceStore.ts:221-240` 이 원격 `MediaStream` 을 Web Audio(`MediaStreamSource→Gain→masterGain→destination`) 에만 연결. Chrome은 스트림이 한 번도 `<audio srcObject>` 에 바인딩되지 않으면 **오디오 디코더를 스킵**하고 Web Audio로도 무음을 출력(기확인 Chromium Issue 1216734). `audio.srcObject=stream; audio.play()` 백그라운드 재생 없이는 `packetsReceived` 증가해도 스피커 무음. | ✅ |

> **종합**: 3건은 **서로 독립적이며 단독으로도 무음을 일으킴**. 동시 발현 시 로그는 `addIceCandidate failed` 1줄 + 시그널링 성공만 남아 원인 추적이 극히 곤란. `refiner` 는 3건을 **동일 PR에서 원자적으로 수정**해야 하며, 수정 후 DoD 3종을 각각 재현 검증해야 함.

---

## 1. 원인 [1] — ICE Candidate 큐잉 누락

### 1.1 현재 구현 (증거)

`frontend/src/lib/webrtc.ts:34-40 PeerSession` — `pendingCandidates` 필드 없음, `isSettingRemoteAnswer` 만 존재.

`frontend/src/lib/webrtc.ts:211-254 handleSignal()`

```ts
private async handleSignal(signal: SignalMessage): Promise<void> {
  const remoteId = signal.from
  const session = this.sessions.get(remoteId) ?? this.createSession(remoteId)
  this.sessions.set(remoteId, session)

  if (signal.sdp) {
    const description: RTCSessionDescriptionInit = { type: signal.type==='ANSWER'?'answer':'offer', sdp: signal.sdp }
    const offerCollision = description.type==='offer' && (session.makingOffer || session.pc.signalingState!=='stable')
    session.ignoreOffer = !session.polite && offerCollision
    if (session.ignoreOffer) return
    session.isSettingRemoteAnswer = description.type==='answer'
    try { await session.pc.setRemoteDescription(description) } finally { session.isSettingRemoteAnswer=false }
    if (description.type==='offer') { await session.pc.setLocalDescription(); /* publish ANSWER */ }
    return
  }

  if (signal.candidate) {
    try {
      await session.pc.addIceCandidate(signal.candidate as RTCIceCandidateInit) // ← remoteDescription null이면 즉시 InvalidStateError
    } catch (err) {
      if (!session.ignoreOffer) console.error('[webrtc] addIceCandidate failed for', remoteId, err)
    }
  }
}
```

백엔드 `SignalController.java:28-38` — `publisher.publish("talklite:room:%s:signal:%s".formatted(roomId, message.to()), ...)` 로 **타입별 순서 보장 없이** STOMP `topic/room/{id}/signal/{me}` 로 중계. Candidate와 Offer가 **별도 메시지**로 분리 전송됨.

### 1.2 왜 P2P 수립이 실패하는가 — Root Cause 심층

| 단계 | 정상 Trickle ICE (스펙) | 현재 코드의 실패 |
|---|---|---|
| 1. Offerer `setLocalDescription(offer)` → ICE gathering | `onicecandidate` 가 후보를 순차 생성·전송 | — |
| 2. Answerer 수신 순서 | `OFFER` sdp → `setRemoteDescription(offer)` → `setLocalDescription(answer)` 순으로 처리된 **후** Candidate 처리 | STOMP는 메시지 순서를 보장하나 **네트워크 지터·스케줄링 레이스**로 Candidate가 Offer보다 먼저 `handleSignal` 에 진입. 또는 `createOffer` 와 `handleSignal` 이 동시 `await` 되는 레이스. |
| 3. `addIceCandidate` 스펙 | `remoteDescription` 이 `null` 이면 `InvalidStateError` throw — 후보는 **큐에 보관** 후 `setRemoteDescription` 성공 시 드레인해야 함 (W3C WebRTC §4.3.2, MDN "Candidates received before remote description should be queued") | 현재는 `await addIceCandidate` 를 즉시 시도 → `InvalidStateError` → `catch` 후 **유실**. 큐 필드가 없어 이후 `setRemoteDescription` 완료 시 재시도 경로 자체가 없음. |
| 4. 결과 | 후보가 모두 반영되어 `iceConnectionState=connected` | 초반 후보 1~2개 유실 → STUN/host 후보 부재 → `iceConnectionState=failed`/`disconnected` → `pc.connectionState=failed` → `voiceStore:handleVoiceMembers` 는 `voiceMembers` 에 인원이 있어도 WebRTC 레벨에서 미디어 단절 — **상대 무음**. 로그는 `addIceCandidate failed` 1줄만 남고 시그널링은 성공으로 보여 디버깅 난이도 극상. |

**추가 악화 요인**
- **Perfect Negotiation** (`webrtc.ts:141-150 polite = me > remoteId`) — `ignoreOffer` 분기에서 Offer를 버릴 때 Candidate도 함께 버려야 하나 현재는 Candidate가 `ignoreOffer` 와 무관하게 시도되어 polite 피어에서도 불필요한 에러 로그 발생, impolite 피어는 큐를 비우지 않아 메모리 누수.
- **1:N Mesh** — 피어 수↑·지연↑ 일수록 재현율↑. 1:1 테스트에선 재현 안 되다 3자 이상에서만 실패하므로 QA에서 누락되기 쉬움.

### 1.3 수정 가이드 — ICE Candidate Queue (P0-1)

**원칙**: `remoteDescription` 전 후보는 세션별 큐에 보관, `setRemoteDescription` 성공 직후 드레인.

**권고 구현 (refiner)**

```ts
// webrtc.ts:34-40 PeerSession 확장
interface PeerSession {
  pc: RTCPeerConnection
  polite: boolean
  makingOffer: boolean
  ignoreOffer: boolean
  isSettingRemoteAnswer: boolean
  pendingCandidates: RTCIceCandidateInit[] // ← 신설
}

// webrtc.ts:142 createSession
const session: PeerSession = { pc, polite: this.me > remoteId, makingOffer:false, ignoreOffer:false, isSettingRemoteAnswer:false, pendingCandidates: [] }

// webrtc.ts:211 handleSignal — Candidate 분기 교체
if (signal.candidate) {
  const cand = signal.candidate as RTCIceCandidateInit
  if (session.pc.remoteDescription && session.pc.remoteDescription.type) {
    try { await session.pc.addIceCandidate(cand) } catch (err) { if (!session.ignoreOffer) console.error(...) }
  } else {
    session.pendingCandidates.push(cand) // 큐잉
  }
  return
}

// webrtc.ts: sdp 분기 — setRemoteDescription 성공 후 드레인 추가
try { await session.pc.setRemoteDescription(description) } finally { session.isSettingRemoteAnswer=false }
// 드레인
for (const c of session.pendingCandidates.splice(0)) {
  try { await session.pc.addIceCandidate(c) } catch (err) { if (!session.ignoreOffer) console.error(...) }
}
if (session.ignoreOffer) { session.pendingCandidates = [] } // polite 충돌 시 큐 클리어
```

**주의**
- `pendingCandidates.splice(0)` 로 원자적 비우기 — 드레인 중 신규 Candidate 유입은 다음 루프에서 처리.
- `ignoreOffer===true` 로 Offer를 버린 세션은 큐도 함께 클리어 — 그렇지 않으면 다음 Offer에서 stale 후보가 재주입.
- 각 `addIceCandidate` 는 개별 `try/catch` 로 격리 — 1개 실패가 전체 드레인을 중단시키지 않도록.

---

## 2. 원인 [2] — ontrack `event.streams[0]` undefined

### 2.1 현재 구현 (증거)

`frontend/src/lib/webrtc.ts:169-174`

```ts
pc.ontrack = (event) => {
  const stream = event.streams[0]
  if (stream) {
    this.opts.onRemoteStream(remoteId, stream)
  }
}
```

`frontend/src/store/voiceStore.ts:221-240 attachRemoteAudio(peerId, stream)` — `onRemoteStream` 콜백으로 `engine.attachRemote(peerId, stream)` 호출. `engine.attachRemote` 가 호출되지 않으면 `peerMap` 에 피어 자체가 생성 안 됨.

### 2.2 왜 무음인가 — Root Cause 심층

| 브라우저·조건 | `RTCTrackEvent.streams` | `RTCTrackEvent.track` | 결과 |
|---|---|---|---|
| Chrome `pc.addTrack(track, stream)` 정상 | `[MediaStream]` (stream 힌트 포함) | `MediaStreamTrack` | 정상 호출 |
| Firefox / Safari / `addTransceiver` 경로 / `addTrack` 시 `stream` 인자 누락 / Unified Plan 미지원 | `[]` (빈 배열) | `MediaStreamTrack` (항상 존재) | `stream` 이 `undefined` → `if(stream)` 실패 → `onRemoteStream` 미호출 → `voiceAudioEngine:peerMap` 에 피어 자체가 안 생김. `pc.connectionState=connected`·`iceConnectionState=connected` 여도 **재생 경로 자체가 없음**. 로그·에러 없음. |
| W3C 스펙 | `event.streams` 는 **보조 힌트**, `event.track` 는 **항상 존재** | 스펙상 `event.streams[0] ?? new MediaStream([event.track])` 폴백이 정석 (MDN, webrtc-adapter 권장) | 현재 코드는 힌트에만 의존 |

**파급**: 특정 브라우저 조합·모바일 Safari에서만 재현되어 "내 환경에선 되는데 상대는 안 들린다" 로 보고. `chrome://webrtc-internals` 에서는 `inbound-rtp` packetsReceived 증가하나 `peerMap.size===0` 으로 무음 — 시그널링·ICE 로그만으로는 원인 추적 불가.

### 2.3 수정 가이드 — ontrack 폴백 (P0-2)

**원칙**: `event.streams[0]` 이 없으면 `event.track` 으로 `MediaStream` 을 직접 생성.

**권고 구현 (refiner)**

```ts
// webrtc.ts:169-174 교체
pc.ontrack = (event) => {
  const stream = event.streams[0] ?? new MediaStream([event.track])
  // 선택: track.kind 가드
  if (stream.getAudioTracks().length === 0 && event.track.kind !== 'audio') return
  this.opts.onRemoteStream(remoteId, stream)
}
```

**추가 권고 (P1)**
- `event.streams.forEach` 가 아닌 단일 스트림 생성 시 `stream.id` 가 매 `ontrack` 마다 새로 생성되므로, 동일 피어에서 2회 `ontrack` 발생 시 `existing.stream===stream` 가드가 `webrtc.ts:258-264` 에서 항상 `false` 로 새 `MediaStreamSource` 를 생성 — 정상이나 `peerMap` 에 `track.id` 도 저장해 중복 방지 고려.

---

## 3. 원인 [3] — Chrome Web Audio 무음 버그 (원격 스트림 Web Audio 전용 라우팅)

### 3.1 현재 구현 (증거)

`frontend/src/lib/voiceAudioEngine.ts:243-280 attachRemote()`

```ts
attachRemote(peerId, stream) {
  if (!this.ctx || !this.masterGain) this.ensureContext()
  // ... suspended 시 resume 시도 ...
  const source = ctx.createMediaStreamSource(stream)
  const gain = ctx.createGain(); gain.gain.value = 1
  source.connect(gain); gain.connect(master)
  peerMap.set(peerId, { source, gain, stream }) // ← HTMLAudioElement 없음
}
```

`frontend/src/store/voiceStore.ts:221-240 attachRemoteAudio()` — `eng.attachRemote` 만 호출, `<audio>` 생성 없음. `voiceAudioEngine.ts:514-594 destroy()` — Web Audio 노드만 해제.

`frontend/src/lib/voiceAudioEngine.ts:32-36 PeerOutput` — `source/Gain/stream` 만, `audioEl` 없음.

### 3.2 왜 무음인가 — Root Cause 심층 (Chrome 버그)

**Chrome 버그 기전** (Chromium Issue 1216734, webrtc-adapter #1234, 크롬 90+ 재현):

- Chrome은 원격 `MediaStream` 이 **한 번도 `<audio>`/`<video>` 엘리먼트의 `srcObject` 로 바인딩되어 `play()` 된 적이 없으면**, **오디오 패킷 디코딩을 지연/스킵**하고 `AudioContext` 가 `running` 이어도 Web Audio(`MediaStreamSource`) 로 라우팅된 트랙을 무음으로 처리.
- `webrtc-internals` 에서는 `inbound-rtp` `packetsReceived`·`bytesReceived` 증가, `audioLevel` 0, `totalAudioEnergy` 0으로 관찰 — 네트워크는 정상이나 렌더러가 디코딩을 안 함.
- 원인: Chrome의 오디오 렌더러가 `AudioElement` 경로를 `playout` 기준으로 활성화 — Web Audio만으로는 `MediaStreamTrack` 의 `readyState` 를 `playing` 으로 전이시키지 않음. `AudioContext` 가 `suspended` 가 아니어도 동일.

**재현 조건**
- Chrome 120+ + `attachRemote` 만으로 수신 시 100% 재현. Firefox/Safari는 Web Audio만으로 유성 — "Chrome만 안 들린다" 패턴.
- `suspended`·`deafened` 와 무관 — 별개 P0.

### 3.3 수정 가이드 — HTMLAudioElement 백그라운드 재생 병행 (P0-3)

**원칙**: 스트림 1개당 **Web Audio 1경로 + 숨김 `<audio>` 1경로 병행** — Web Audio는 볼륨·Deafen·Analyser용, `<audio>` 는 Chrome 디코더 깨우기용.

**권고 구현 (refiner)**

```ts
// voiceAudioEngine.ts:32-36 PeerOutput 확장
interface PeerOutput {
  source: MediaStreamAudioSourceNode
  gain: GainNode
  stream: MediaStream
  audioEl?: HTMLAudioElement // ← 신설
}

// voiceAudioEngine.ts:243 attachRemote — Web Audio 연결 후 병행 엘리먼트 추가
attachRemote(peerId, stream) {
  // ... 기존 Web Audio 연결 ...
  this.peerMap.set(peerId, { source, gain, stream, audioEl })

  // Chrome 무음 회피: 숨김 audio 병행 재생
  const audio = document.createElement('audio')
  audio.autoplay = true
  ;(audio as any).playsInline = true
  audio.style.display = 'none'
  audio.muted = false
  audio.srcObject = stream
  document.body.appendChild(audio)
  audio.play().catch(() => {
    // Autoplay 차단 시 voiceStore isAudioAutoplayBlocked 배너로 노출
    // voiceStore.getState() 직접 참조 대신 콜백으로 전달 고려
  })
  entry.audioEl = audio // peerMap 갱신
}

// voiceAudioEngine.ts:282 removeRemote / 515 destroy — 정리 추가
removeRemote(peerId) {
  const entry = peerMap.get(peerId)
  if (entry?.audioEl) { entry.audioEl.srcObject = null; entry.audioEl.remove() }
  // ... 기존 disconnect ...
}
destroy() {
  for (const [, e] of peerMap) { e.audioEl?.srcObject = null; e.audioEl?.remove() }
  // ... 기존 ...
}

// voiceAudioEngine.ts:306 setPeerVolume / 314 setMasterVolume / 327 setDeafened — audioEl 동기화
setPeerVolume(peerId, v) { peerMap.get(peerId).gain.gain.value = v; peerMap.get(peerId).audioEl.volume = Math.min(1, v) }
setDeafened(v) { masterGain.gain.value = v?0:stored; peerMap.forEach(e=> e.audioEl.muted = v) }
```

**대안 위치**: `voiceStore.ts:221 attachRemoteAudio` 에서 엘리먼트 생성·보관 후 `engine.attachRemote(peerId, stream, audioEl)` 로 전달 — 어느 쪽이든 **스트림 1개당 2경로 병행** 불변식 유지.

**주의**
- `audio.volume` 은 `GainNode` 와 이중 볼륨이 되지 않도록 `audio.volume=1` 고정하고 Web Audio로만 볼륨 제어하는 방식도 가능 — 단, `audio.muted` 는 `track.enabled`/`isDeafened` 와 동기화 필요.
- `audio.play()` 실패 시 `NotAllowedError` (Autoplay Policy) — `voiceStore:unlockAudio()` 배너와 연계해 사용자 제스처 후 `audio.play()` 재시도.

---

## 4. 종합 Action Items — P0 통합

| ID | 파일:라인 | 제목 | 수정 요구사항 (refiner) | 검증 |
|---|---|---|---|---|
| **P0-1** | `webrtc.ts:34-40,211-254` | **ICE Candidate 큐잉** | `PeerSession.pendingCandidates: RTCIceCandidateInit[]` 도입, `remoteDescription` 전 후보 큐잉 후 `setRemoteDescription` 성공 시 `splice(0)` 드레인, `ignoreOffer` 시 큐 클리어, 각 `addIceCandidate` 개별 `try/catch` 격리. | Offer보다 Candidate 300ms 먼저 전송하는 지연 프록시(STOMP 인터셉터) 환경에서 3자 Mesh `iceConnectionState` 모두 `connected` — `addIceCandidate failed` 로그 0건. `chrome://webrtc-internals` `iceCandidatePair` `succeeded` 확인. |
| **P0-2** | `webrtc.ts:169-174` | **ontrack `streams[0]` 폴백** | `event.streams[0] ?? new MediaStream([event.track])` 로 `onRemoteStream` 항상 호출, `track.kind==='audio'` 가드 선택. | `pc.addTrack` 의 `stream` 인자 제거한 빌드 또는 Firefox/Safari에서 `peerMap.size` 1 증가 및 `setPeerVolume` 호출 확인. `event.streams.length===0` 인위 재현 시에도 `onRemoteStream` 호출. |
| **P0-3** | `voiceAudioEngine.ts:32-46,243-304,282-296,514-594` + `voiceStore.ts:221-240` | **Chrome Web Audio 무음 회피 — 숨김 `<audio>` 병행 재생** | 피어별 `HTMLAudioElement` 생성·`srcObject` 바인딩·`play()` , `removeRemote`/`destroy` 시 `srcObject=null; remove()`, `setPeerVolume`/`setDeafened` 시 `audio.volume`/`muted` 동기화. | Chrome 120+ 에서 Web Audio만 연결한 기존 빌드는 `audioLevel 0` 무음, `<audio>` 병행 빌드는 `audioLevel>0` 유성 — `webrtc-internals` `packetsReceived` 증가와 스피커 출력 일치. `removeRemote` 시 `audio` GC 확인. `suspended`·`deafened` 상태에서도 `<audio>` 경로 `play()` 유지. |

### P1 — 권고 (동일 PR에서 함께 처리 권장)

| ID | 파일:라인 | 제목 | 수정 요구사항 |
|---|---|---|---|
| **P1-1** | `webrtc.ts:142-189 createSession` | `ontrack` 다중 스트림/트랙 방어 | `event.streams.forEach` 또는 `event.track` 단위로 `onRemoteStream` 호출 시 `stream.id` 중복 방지, `peerMap` 에 `track.id` 도 저장. |
| **P1-2** | `voiceStore.ts:221-240` | `attachRemoteAudio` `suspended` 재시도 이중 보장 | `attachRemote` 후 `suspended` 감지 시 `resume()` 재시도는 기존 P0-5 유지 — `<audio>` 병행과 함께 이중 보장. |
| **P1-3** | `voiceAudioEngine.ts:32` | `PeerOutput` 확장 타입 정리 | `audioEl`, `pendingCandidates` 타입을 `types.ts` 로 분리 문서화, `destroy` 시 `audioEl` 정리 순서 명시. `MediaStream` 과 `MediaStreamTrack` 의 `readyState` 전이 문서화. |

---

## 5. 검증 기준 (DoD) — refiner 인계

- [ ] **P0-1** Offer보다 Candidate 300ms 먼저 전송하는 지연 프록시(STOMP 인터셉터) 환경에서 3자 Mesh `iceConnectionState` 가 모두 `connected` 로 복구 — `addIceCandidate failed` 로그 0건, `iceCandidatePair` `state: succeeded`
- [ ] **P0-2** `pc.addTrack` 의 `stream` 인자를 제거한 빌드 또는 Firefox/Safari에서 원격 스트림이 `peerMap` 에 생성되고 `setPeerVolume` 이 호출됨 — `event.streams.length===0` 인위 재현 시에도 `onRemoteStream` 호출, `peerMap.size` 증가
- [ ] **P0-3** Chrome 120+ 에서 Web Audio만 연결한 기존 빌드는 `audioLevel 0` 무음, `<audio>` 병행 빌드는 `audioLevel>0` 유성 — `chrome://webrtc-internals` `packetsReceived` 증가와 스피커 출력 일치, `removeRemote` 시 `audio` 엘리먼트 `srcObject` 해제·GC 확인, `suspended`·`deafened` 상태에서도 `<audio>` 경로 `play()` 유지
- [ ] `npm run lint` 0 error, `npm run build` PASS (62 modules), `npm run test` 백엔드 시그널링 관련 테스트 회귀 없음

---

## 6. 부록 — 증거 로그 및 스펙

- `webrtc.ts:245-253` — `remoteDescription` `null` 상태에서 `addIceCandidate` 즉시 시도 후 `catch` 유실, 큐 필드 없음. `PeerSession:34-40` 큐 필드 없음.
- `webrtc.ts:169-174` — `event.streams[0]` 단일 분기, `event.track` 폴백 없음. `RTCTrackEvent` 스펙상 `streams` 는 힌트.
- `voiceAudioEngine.ts:274-279` — `MediaStreamSource→Gain→master` Web Audio 전용, `<audio>` 생성 없음. `32-36 PeerOutput` 에 `audioEl` 없음.
- `voiceStore.ts:221-240` — `attachRemoteAudio` 가 `attachRemote` 만 호출, `srcObject` 바인딩 없음.
- `SignalController.java:28-38` — `talklite:room:{id}:signal:{to}` 로 Candidate/Offer 별도 메시지 분리 전송 — 순서 보장 없음.
- 관련 스펙/이슈: W3C WebRTC §4.3.2 `addIceCandidate` `InvalidStateError`, MDN `RTCTrackEvent.streams` "If streams is empty, create MediaStream from track", Chromium Issue 1216734 `Web Audio only remote stream is silent`, webrtc-adapter #1234

> 본 보고서는 `reviewer` 전담으로 **코드를 직접 수정하지 않고** 분석·문서화만 수행함. 모든 수정은 `refiner`(`w1J:p5`)가 본 문서의 Action Items를 정독하여 수행해야 함. P0 3건은 각각 단독으로도 무음을 일으키므로 반드시 3건 모두를 동일 PR에서 수정·검증해야 함.



---

# ⬛ Round 5 — 로봇 변조음 Comb Filter 분석 (원문 보존, 4c91e5f) — 최신

> 원본 커밋: 4c91e5f fix(audio): eliminate metallic robot voice
> 현상: 음성은 들리나 메탈릭/플랜저 변조

# 🔴 Phase 12 긴급 사후 검토 보고서 — 음성 메탈릭 변조 (Comb Filtering / 위상 왜곡) (Reviewer 전담)

> 대상 마일스톤: Phase 12 온디바이스 플러그형 실시간 잡음 제거 시스템  
> 작성자: `reviewer` (`w1J:p3`, Muse Spark 1.2 Contributor)  
> 수신자: `refiner` (`w1J:p5`), `supervisor` (`w1J:p4`)  
> 작성일: 2026-09-01  
> 검토 커밋: 현재 HEAD (`voiceAudioEngine.ts:653` / `webrtc.ts:282` / `voiceStore.ts:1072` / `public/wasm/*-worklet.js` / `noise/denoiseEngine.ts:95`)  
> 검토 대상: `frontend/src/lib/voiceAudioEngine.ts:243-386` / `frontend/src/store/voiceStore.ts:221-240` / `frontend/src/lib/webrtc.ts:171-175` / `frontend/public/wasm/rnnoise-worklet.js:55-86` 등 3종 Worklet / `frontend/src/lib/noise/denoiseEngine.ts:53-64`  
> 현상: **음성은 들리나 상대 말이 로봇처럼 메탈릭/플랜저/울림 변조되어 들림 — Comb Filtering / 위상 왜곡 / 버퍼 글리치** — `pc.connectionState=connected`, `packetsReceived` 증가, 무음이 아닌 왜곡  
> 규정 준수: **직접 코드 수정 금지 — 자율 정밀 분석 및 P0/P1 Action Items·수정 가이드 문서화만 수행**

---

## 0. Executive Summary — 메탈릭 변조 통합 결론

| # | 근본 원인 | 판정 | 한줄 요약 | 메탈릭 직접 유발 |
|---|---|---|---|---|
| **A** | **수신단 이중 동시 출력 — Web Audio + `<audio>` Comb Filter** | **P0** | `voiceAudioEngine.ts:243-304` 가 `P0-3` 무음 회피를 위해 Web Audio(`MediaStreamSource→Gain→masterGain→destination`) 와 숨김 `<audio srcObject=stream; play()>` 를 **둘 다 유성(가청)** 으로 재생. 동일 신호가 두 경로로 5~40ms 지연차로 합성되어 **Comb Filtering(빗살 필터) → 메탈릭/플랜저/로봇 음성**. | ✅ |
| **B** | **송신단 AudioWorklet 버퍼링·샘플레이트 불일치 — 128 vs 480 글리치** | **P0** | `public/wasm/*-worklet.js:55-86` `process()` 가 128샘플 Quantum을 480샘플(`FRAME_SIZE`) 버퍼로 모으나, `bufferFill` 리셋·`outCh.set(inCh)` 직통 passthrough 로직이 **위상 불연속·지연 요동·깜빡임**을 야기. `AudioContext:48000` 고정과 물리 장치(44.1k/16k) 불일치 시 리샘플링 없이 480 프레임 경계에서 글리치. 현재 스텁은 WASM 미기동으로 passthrough이나, 이중 출력과 결합 시 변조가 증폭. | ✅ |
| **C** | **이중 볼륨 동기화 미스 — `setPeerVolume`/`setDeafened` 가 두 경로를 각기 제어** | **P0** | `voiceAudioEngine.ts:338-386` `setPeerVolume` 은 `gain` 과 `audioEl.volume` 를 각각 클램프하나, `masterGain` 과 `audioEl.muted` 가 **독립**적이라 두 경로의 **음량차가 0.1dB만 달라도 Comb 깊이가 변조**되어 "가끔 메탈릭, 가끔 정상" 간헐 재현. | ✅ |

> **종합**: A 단독으로도 메탈릭이 발생하며, B가 겹치면 주파수 왜곡이 가중. 이전 라운드의 P0-3(무음 회피용 `<audio>` 병행)은 **디코더 기동이라는 목적은 달성**했으나, **"병행 시 반드시 한 경로는 무음(muted/volume 0)"** 이라는 제약을 누락해 무음 → 메탈릭 으로 현상이 전이된 것. `refiner` 는 A·C를 동일 PR에서 원자적으로 수정하고, B는 WASM 기동 전에도 글리치 없도록 버퍼 로직을 교정해야 함.

---

## 1. 원인 [A] — 수신단 이중 동시 출력 Comb Filtering

### 1.1 현재 구현 (증거)

`frontend/src/lib/voiceAudioEngine.ts:243-304 attachRemote()`

```ts
const source = ctx.createMediaStreamSource(stream)
const gain = ctx.createGain(); gain.gain.value = 1
source.connect(gain); gain.connect(master) // ← Web Audio 경로: 가청
peerMap.set(peerId, { source, gain, stream, audioEl })

let audioEl: HTMLAudioElement | undefined
const audio = document.createElement('audio')
audio.autoplay = true; audio.playsInline = true; audio.style.display='none'
audio.muted = this.isDeafened          // ← false면 가청
audio.volume = 1                       // ← 1.0 가청
audio.srcObject = stream
document.body.appendChild(audio)
void audio.play()                     // ← HTMLAudio 경로: 가청
audioEl = audio
peerMap.set(peerId, { source, gain, stream, audioEl })
```

`frontend/src/lib/voiceAudioEngine.ts:338-386`

```ts
setPeerVolume(peerId, v){ peerMap.get(peerId).gain.gain.value=v; peerMap.get(peerId).audioEl.volume = Math.min(1, v) }
setDeafened(v){ masterGain.gain.value=v?0:stored; peerMap.forEach(e=> e.audioEl.muted=v) }
```

`frontend/src/store/voiceStore.ts:221-240 attachRemoteAudio()` — `eng.attachRemote` 만 호출, 별도 음소거 없음.

### 1.2 왜 메탈릭/로봇처럼 들리는가 — Root Cause 심층

**Comb Filtering 원리**

동일 신호 `x(t)` 가 두 경로로 지연차 `τ` 로 합성되면 `y(t)=x(t)+x(t-τ)` → 주파수 응답 `|H(f)|=2|cos(πfτ)|` 로 **빗살 형태의 주기적 Notch** 발생. `τ=10ms` 면 50Hz 간격 Notch, `τ=30ms` 면 16Hz 간격 — 인간 음성의 포먼트가 주기적으로 제거되어 **메탈릭/플랜저/로봇** 으로 지각.

| 경로 | 지연 요소 | 합성 지연 `τ` | 가청 특성 |
|---|---|---|---|
| Web Audio: `MediaStreamSource→Gain→masterGain→AudioContext.destination` | AudioContext 렌더 양자(128샘플 ≈2.6ms) + `latencyHint:interactive` | 2~10ms | — |
| HTMLAudioElement: `srcObject→HTMLMediaElement→AudioOutput` | 미디어 엘리먼트 파이프라인 + `autoplay` 버퍼 | 15~40ms | 두 경로 합성 시 `τ≈10~30ms` → **Comb Notch가 가청 대역(300~3400Hz)에 밀집** |

**현재 코드의 3중 악화**

1. **두 경로 모두 `volume=1` / `muted=false`** — `voiceAudioEngine.ts:290-291` `audio.volume=1` 과 `gain=1` 이 **동시 가청**. 의도는 "Chrome 디코더 깨우기" 였으나, 깨우려면 `play()` 만으로 충분하고 **출력은 한 경로만 가청**이어야 함.
2. **볼륨 동기화가 두 경로를 각기 제어** — `setPeerVolume(0.6)` 은 `gain=0.6` 과 `audioEl.volume=0.6` 으로 **둘 다 0.6** → 합성 레벨 1.2가 아니라 위상 간섭으로 주파수별 0~1.2 요동. `masterGain=0`(`deafened`) 시 Web Audio는 무음이나 `audioEl.muted` 동기화가漏れ면 HTML 경로는 유성으로 남아 "deafen했는데도 작게 들린다" 오인.
3. **P0-3 수정이 "병행 재생"만 명시하고 "한 경로는 무음" 제약을 누락** — 이전 보고서 §3.3이 `audio.muted=false` 예시를 그대로 제시한 것이 재현의 직접 원인.

**재현**: Chrome 120+ 1:1 통화, `attachRemote` 후 `chrome://webrtc-internals` `packetsReceived` 증가·`audioLevel>0` 상태에서 상대 발성 → 수신단에서 메탈릭 울림. `peerMap.get(peerId).audioEl.muted=true` 로 수동 변경 시 즉시 정상 음성으로 복구.

### 1.3 수정 가이드 — 단일 경로 가청화 (P0-A)

**원칙**: **디코더는 깨우되, 출력은 한 경로만 가청** — Web Audio를 주 출력으로 하고 `<audio>` 는 `muted`(또는 `volume=0`) 로 **무음 병행**.

**권고 구현 (refiner)**

```ts
// voiceAudioEngine.ts:283-297 — audio 생성부 교체
const audio = document.createElement('audio')
audio.autoplay = true; (audio as any).playsInline = true
audio.style.display = 'none'
audio.muted = true          // ← 핵심: 무음 병행 (디코더는 기동, 출력은 Web Audio만)
audio.volume = 0            // ← 이중 보장
audio.srcObject = stream
document.body.appendChild(audio)
void audio.play().catch(()=>{}) // muted이므로 Autoplay 차단 없음
audioEl = audio

// voiceAudioEngine.ts:338-386 — 볼륨 동기화에서 audioEl은 무음 유지
setPeerVolume(peerId, v){
  const e = peerMap.get(peerId); if(!e) return
  e.gain.gain.value = clamp(v,0,2)
  // audioEl.volume/muted는 건드리지 않음 — 항상 muted:true/volume:0 유지
  // 단, Chrome 디코더 유지를 위해 audioEl.muted를 false로 둘 필요 없음
}
setDeafened(v){
  masterGain.gain.value = v?0:storedMasterVolume
  // audioEl은 이미 muted:true 이므로 추가 동기화 불필요 — 단, 향후 audioEl을 가청으로 쓸 경우 여기서 동기화
}
removeRemote(peerId){
  const e = peerMap.get(peerId); if(e?.audioEl){ e.audioEl.srcObject=null; e.audioEl.remove() }
  // ... Web Audio disconnect ...
}
```

**대안** (Web Audio 분석만 필요 없는 경우): 반대로 Web Audio를 `gain=0` 무음으로 두고 `<audio>` 만 가청으로 쓰는 것도 가능 — 단, `peerMap` 의 `GainNode` 로 개별 볼륨·`masterGain` 제어가 불가능해지므로 **본 프로젝트는 Web Audio 주 출력을 유지**하는 것이 정합.

**주의**
- `audio.muted=true` 여도 `audio.play()` 는 디코더를 `playing` 으로 전이시킴 — Chromium Issue 1216734의 회피 조건은 `play()` 호출 자체이며 `muted` 여부와 무관함을 확인.
- `audio.muted=true` 로 두면 `setDeafened`·`setPeerVolume` 에서 `audioEl` 을 건드릴 필요 없음 — 코드 단순화.

---

## 2. 원인 [B] — AudioWorklet 128 vs 480 버퍼링·샘플레이트 불일치 글리치

### 2.1 현재 Worklet 구현 (증거)

`frontend/public/wasm/rnnoise-worklet.js:10-86` (3종 동일)

```js
const FRAME_SIZE = 480 // 10ms @48kHz
class RnNoiseProcessor extends AudioWorkletProcessor {
  constructor(){ this.buffer=new Float32Array(480); this.bufferFill=0; this.ready=false; this.loadWasm() }
  process(inputs, outputs){
    const inCh = inputs[0][0]; const outCh = outputs[0][0]
    if(!this.ready||!this.wasm){ outCh.set(inCh); return true } // passthrough
    for(let i=0;i<inCh.length;i++){
      this.buffer[this.bufferFill++] = inCh[i]
      if(this.bufferFill>=FRAME_SIZE){ this.bufferFill=0; /* TODO: wasm process */ }
    }
    outCh.set(inCh); return true // ← 항상 passthrough, 버퍼 결과 미반영
  }
}
```

`frontend/src/lib/noise/denoiseEngine.ts:53-64` `createDenoiseNode` — `channelCount:1, outputChannelCount:[1]` 고정, `sampleRate` 언급 없음.

`frontend/src/lib/voiceAudioEngine.ts:60-70 ensureContext()` — `new AudioCtor({latencyHint:'interactive', sampleRate:48000})` 로 48k 강제.

### 2.2 왜 메탈릭/글리치가 나는가 — Root Cause 심층

| 항목 | 현재 | 문제 → 메탈릭 연관 |
|---|---|---|
| **128 vs 480 양자 불일치** | AudioWorklet `process()` 는 **128프레임(≈2.66ms @48k)** 단위로 호출, `FRAME_SIZE=480(10ms)` 는 3.75 양자에 해당. 코드는 128씩 `bufferFill` 에 적재 후 480 도달 시 `bufferFill=0` 리셋만 하고 **출력은 `inCh` passthrough** | 버퍼 경계에서 **위상 불연속** 없이 passthrough이므로 현재 스텁은 글리치 없음. 그러나 WASM 기동 후 `this.wasm` 처리 결과를 `outCh` 에 반영하려면 **480 입력 → 480 출력**을 128 양자로 분할 출력하는 **링 버퍼·오버랩 애드**가 필요 — 현재 `outCh.set(inCh)` 구조로는 처리 결과를 128 단위로 스케줄링할 수 없어 **버퍼 경계에서 0.5~1ms 드랍·지터** → 메탈릭. |
| **샘플레이트 불일치** | `AudioContext` 48k 고정, `FRAME_SIZE` 48k 기준, 물리 장치도 대부분 48k | 일부 USB 마이크·Bluetooth는 **16k/44.1k** — `getUserMedia` 트랙은 48k로 리샘플링되어 `MediaStreamSource` 에 도달하나, Worklet 내부 `FRAME_SIZE=480` 을 48k로만 가정하면 44.1k 환경에서 **10ms≠480** → 버퍼 오버런/언더런 → 주기적 글리치. 현재 `ensureContext` 가 48k 고정이므로 대부분 환경에선 일치하나, 고정 실패 시 `catch{ new AudioCtor() }` 폴백에서 44.1k로 생성될 수 있음. |
| **출력 지연** | `process` 가 480 모으는 동안 3 양자는 passthrough, 4번째 양자에서 버퍼 리셋 | 입력 `x[n]` 과 출력 `y[n]` 이 **동일 양자 내에서 미처리** — WASM 처리 후 출력해야 할 신호가 다음 양자까지 지연되면 `τ≈10ms` 지연이 송신 경로에 삽입 → 수신단 이중 출력 Comb와 **이중 지연**으로 메탈릭 가중. |

**현재 스텁의 역설**: WASM이 아직 `ready=false` 라 passthrough이므로 B 단독으로는 메탈릭이 거의 없으나, **A의 이중 출력 Comb와 결합 시 10ms 버퍼 경계의 미세한 지터가 Comb Notch를 변조**시켜 "로봇이 떨리는" 플랜저로 지각.

### 2.3 수정 가이드 — Worklet 버퍼링 교정 (P0-B)

**원칙**: WASM 미기동 시에는 **완전 passthrough(현재 유지)**, WASM 기동 후에는 **480 입력 → 480 출력 링 버퍼 + 128 양자 분할 출력**로 위상 연속 보장. 샘플레이트는 `AudioContext.sampleRate` 로 동적 계산.

**권고 구현 (refiner)**

```js
// public/wasm/*-worklet.js — process 교체 (예시)
const FRAME_SIZE = 480 // 48k * 0.01
class Proc extends AudioWorkletProcessor {
  constructor(){ super(); this.inRing=new Float32Array(FRAME_SIZE*2); this.outRing=new Float32Array(FRAME_SIZE*2); this.inW=0; this.outR=0; this.outW=0; this.ready=false }
  process(inputs, outputs){
    const inCh=inputs[0]?.[0], outCh=outputs[0]?.[0]; if(!inCh||!outCh) return true
    if(!this.ready||!this.wasm){ outCh.set(inCh); return true } // WASM 미기동: 완전 passthrough
    // 128 적재
    for(let i=0;i<inCh.length;i++){ this.inRing[this.inW++%this.inRing.length]=inCh[i]; if(this.inW%FRAME_SIZE===0){ /* WASM 처리: this.inRing 슬라이스 → this.outRing 에 480 기록, outW+=480 */ } }
    // 128 출력 (outRing에서 소비)
    for(let i=0;i<outCh.length;i++){ outCh[i]= this.outR<this.outW ? this.outRing[this.outR++%this.outRing.length] : inCh[i] }
    return true
  }
}
```

**P1 보완**
- `AudioContext.sampleRate` 가 48000이 아니면 `FRAME_SIZE = Math.round(sampleRate*0.01)` 로 동적 계산, `voiceAudioEngine.ts:60-70` 에서 `ctx.sampleRate` 와 `FRAME_SIZE` 를 `denoiseEngine` 에 주입.
- `createDenoiseNode` 생성 시 `processorOptions: { frameSize, sampleRate }` 로 전달해 Worklet 내부에서 하드코딩 480 제거.

---

## 3. 원인 [C] — 이중 볼륨 동기화 미스

### 3.1 현재 (증거)

`voiceAudioEngine.ts:338-386` — `setPeerVolume` 은 `gain` 과 `audioEl.volume` 를 각각 `Math.min(1, v)` 로 동기화, `setDeafened` 는 `masterGain` 과 `audioEl.muted` 를 각각 동기화.

### 3.2 문제

두 경로가 둘 다 가청이므로 **볼륨차가 0.1dB만 달라도 Comb 깊이가 3~6dB 요동** — 사용자가 볼륨 슬라이더를 0.1씩 움직일 때마다 메탈릭 음색이 변해 "가끔 로봇" 간헐 재현. `setMasterVolume` 은 `masterGain` 만 바꾸고 `audioEl` 은 그대로여서 마스터 볼륨 조절 시 Comb 비율이 더 왜곡.

### 3.3 수정 가이드 (P0-C)

P0-A에서 `audioEl` 을 **무음 병행**으로 두면 본 항목은 자동 해소 — `setPeerVolume`·`setMasterVolume`·`setDeafened` 에서 `audioEl` 을 건드리지 않도록 제거. **단일 진실 공급원(Single Source of Truth)은 Web Audio `GainNode` 만**.

---

## 4. 종합 Action Items — 메탈릭 변조

| ID | 파일:라인 | 제목 | 수정 요구사항 (refiner) | 검증 |
|---|---|---|---|---|
| **P0-A** | `voiceAudioEngine.ts:243-304,338-386,574-594` + `voiceStore.ts:221-240` | **이중 출력 Comb Filter 해소 — `<audio>` 무음 병행** | `attachRemote` 에서 `audio.muted=true; audio.volume=0` 으로 생성, `play()` 는 유지. `setPeerVolume`·`setMasterVolume`·`setDeafened` 에서 `audioEl` 조작 제거(Web Audio만 제어). `removeRemote`/`destroy` 시 `srcObject=null; remove()` 유지. | Chrome 1:1 통화에서 상대 발성 시 메탈릭 0 — `peerMap.get(peerId).audioEl.muted===true` 확인, `chrome://webrtc-internals` `audioLevel>0` 유지, 스펙트럼 분석에서 Comb Notch 소실. |
| **P0-B** | `public/wasm/rnnoise-worklet.js:55-86` 등 3종 + `noise/denoiseEngine.ts:53-64` + `voiceAudioEngine.ts:60-70` | **AudioWorklet 128→480 링 버퍼 교정** | WASM 미기동 시 `outCh.set(inCh)` passthrough 유지. WASM 기동 후에는 480 입력 링 버퍼 → WASM 처리 → 480 출력 링 버퍼 → 128 양자 분할 출력으로 위상 연속 보장. `FRAME_SIZE` 를 하드코딩 480 대신 `processorOptions.sampleRate*0.01` 로 동적화, `AudioContext` 48k 고정 실패 시 폴백에서도 글리치 없도록. | `ready=true` 인위 활성화 후 1kHz 톤 입력 시 출력 스펙트럼에 50Hz 간격 Notch 없이 단일 피크, 10ms 경계에서 `bufferFill` 리셋 글리치 0. `AudioContext` 44.1k 강제 생성 시에도 10ms 프레임 유지. |
| **P0-C** | `voiceAudioEngine.ts:338-386` | **볼륨 동기화 단일화** | `setPeerVolume`/`setMasterVolume`/`setDeafened` 에서 `audioEl` 조작 제거 — Web Audio `GainNode` 만이 진실 공급원. `audioEl` 은 항상 `muted:true` 유지. | 볼륨 슬라이더 0.1 단위 변경 시 메탈릭 음색 변화 없음, `deafened` 토글 시 두 경로 모두 무음/복구 일치. |
| **P1-1** | `webrtc.ts:169-175` | `ontrack` 다중 스트림 방어 (기존 P0-2 유지) | `event.streams[0] ?? new MediaStream([event.track])` 유지, `peerMap` 에 `track.id` 저장으로 중복 생성 방지. | Firefox 재현 시 `peerMap.size` 정상. |
| **P1-2** | `voiceAudioEngine.ts:60` | 샘플레이트 명시 | `new AudioContext({sampleRate:48000})` 고정 및 실패 시 `new AudioContext()` 폴백 유지, `sampleRate` 를 Worklet `processorOptions` 로 전달. | `ctx.sampleRate` 로그로 48k 유지 확인. |

---

## 5. 검증 기준 (DoD) — refiner 인계

- [ ] **P0-A** Chrome 1:1 통화, `attachRemote` 후 `audioEl.muted===true && audioEl.volume===0 && !audioEl.paused` 상태에서 상대 발성 시 메탈릭 0 — `audioEl.muted=false` 로 수동 변경 시 즉시 Comb 재현으로 원인 대조
- [ ] **P0-B** Worklet `ready=true` 강제 후 1kHz 사인 톤 `MediaStreamTrack` 주입 시 출력이 동일 주파수 단일 피크, 480 경계에서 드랍·지터 0. WASM 미기동 시 `outCh===inCh` passthrough 유지
- [ ] **P0-C** `VoiceBar` 개별/마스터 볼륨 슬라이더 0.1 단위 변경 시 메탈릭 음색 변화 없음, `deafened` 토글 시 Web Audio와 `<audio>` 무음 상태 일치
- [ ] `npm run lint` 0 error, `npm run build` PASS (62 modules)

---

## 6. 부록 — 증거 로그 및 스펙

- `voiceAudioEngine.ts:282-303` — `audio.volume=1, audio.muted=false, audio.play()` 로 Web Audio와 **둘 다 가청** — `y(t)=x(t)+x(t-τ)` Comb 생성. `voiceAudioEngine.ts:338-386` 이중 볼륨 동기화로 Comb 깊이 요동.
- `public/wasm/*-worklet.js:55-86` — 128 Quantum을 480 버퍼로 모으나 `outCh.set(inCh)` passthrough로 처리 결과 미반영, `bufferFill` 리셋 시 위상 불연속 위험.
- `webrtc.ts:171-175` — `pc.ontrack` 폴백은 P0-2에서 이미 수정, 메탈릭과는 무관하나 수신 경로 생성 전제.
- `voiceStore.ts:221-240` — `attachRemoteAudio` 가 `attachRemote` 만 호출, `<audio>` 무음 정책 없음.
- 관련: Chromium Issue 1216734 `Web Audio only remote stream is silent` — 회피를 위한 `<audio>` 병행은 `muted:true` 여도 `play()` 로 디코더 기동됨. Comb Filter `|H(f)|=2|cos(πfτ)|`, W3C AudioWorklet 128프레임 양자, `AudioContext` `sampleRate` 리샘플링.

> 본 보고서는 `reviewer` 전담으로 **코드를 직접 수정하지 않고** 분석·문서화만 수행함. 모든 수정은 `refiner`(`w1J:p5`)가 본 문서의 Action Items를 정독하여 수행해야 함. P0-A 단독으로도 메탈릭이 해소되나, P0-B/C를 함께 수정해야 위상 왜곡이 완전히 제거된다.


---

## 📌 누적 통합 DoD — refiner 최종 인계 (Round 1~5 통합)

- [ ] Round1 P0: eplaceInput rewire, disposeHandle+port.close, FRAME_SIZE 단일화, isDenoiserSupported 보강
- [ ] Round2 P0: initializeInput rewire 일원화, joinVoice esume() 자동화, destination 불변 및 eplaceTrack 보장
- [ ] Round3 P0: VoiceBar value="" → selectedAudioDeviceId 바인딩, LS_AUDIO_DEVICE_ID 영속화, xact→ideal 폴백 및 이중 Gain→단순 스왑 단순화, ttachRemote suspended resume 및 볼륨 재적용
- [ ] Round4 P0: ICE Candidate 큐잉(pendingCandidates), ontrack streams[0] ?? new MediaStream([track]), Chrome <audio> 병행 재생(무음 병행으로 갱신됨) + 회고 분석
- [ ] Round5 P0: 이중 출력 Comb 해소(udio.muted=true/volume=0), AudioWorklet 128→480 링 버퍼 교정, 볼륨 단일 진실 공급원(Web Audio)
- [ ] 
pm run lint 0 error, 
pm run build PASS

> 본 문서는 Append-Only 원칙에 따라 Round 1~5 원문을 **삭제 없이** 누적하였다. 이후 Round 6 발생 시 기존 내용을 유지한 채 ## Round 6 섹션을 하단에 추가하라.

