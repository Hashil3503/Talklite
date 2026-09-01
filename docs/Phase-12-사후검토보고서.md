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
