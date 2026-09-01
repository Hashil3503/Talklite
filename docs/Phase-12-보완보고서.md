# Phase 12 Step 6 — 사후 보완 완료 보고서 (Refiner)

> Phase: 12 온디바이스 플러그형 실시간 잡음 제거 시스템  
> 담당: refiner (Muse Spark 1.2 Contributor)  
> 일시: 2026-09-01 (4차 보완: WebRTC 3대 근본 원인 P0-1 ICE 큐·P0-2 ontrack 폴백·P0-3 Chrome 무음 회피)  
> 기반: `docs/Phase-12-사후검토보고서.md` (reviewer, 2026-09-01, 긴급 3대 근본 원인) — 직접 정독·원자적 반영

---

## 1. Action Items 보완 내역 (1~4차 통합)

### 1차 보완 (기초 P0/P1/P2)
| ID | 파일:라인 | 조치 | 상세 |
|---|---|---|---|
| P0-2/1차, P1-5, P2 | `types.ts:21` / `denoiseEngine.ts:16,77` / `voiceAudioEngine.ts:585` / `VoiceBar.tsx:312` | FRAME_SIZE 단일화 / `port.close()` / teardown 선행 / a11y | `FRAME_SIZE=480` 단일 소스, `disposeHandle` `port.close()`, `destroy` teardown 선행, `<div aria-labelledby>` 교체 — 3차에서도 유지. |

### 2차 보완 (P0-1~P0-3 긴급)
| ID | 파일:라인 | 조치 | 상세 |
|---|---|---|---|
| P0-1A/2차 | `voiceAudioEngine.ts:230` | `initializeInput()` 직결 제거·`rewire` 일원화 | 초기 진입 3중 출력 중복 해소 — 3차 단순 스왑 파이프라인으로 대체·발전. |
| P0-2/2차 | `voiceStore.ts:597` | `joinVoice` `await eng.resume()` 선행 | `suspended` 무음 방지 — 3차에서도 유지. |

### 3차 보완 (P0-1~P0-5 드롭다운/단순 스왑)
| ID | 파일:라인 | 조치 | 상세 |
|---|---|---|---|
| **P0-1~P0-3/3차** | `VoiceBar.tsx:410` / `voiceStore.ts:27,120,437,666` / `voiceAudioEngine.ts:52,60,130,232` | 드롭다운 바인딩·영속화·`exact→ideal`·단순 스왑 | **P0-1** `value={selectedAudioDeviceId??''}` + `>0`·`aria-label`, **P0-2** `LS_AUDIO_DEVICE_ID`·`selectedAudioDeviceId`·`devicechange`·`joinVoice ideal`, **P0-3** `setDevice` 3단계 폴백·세분화 토스트, **P0-4** 이중 Gain→단순 스왑 2택 1, **P0-5** `attachRemote` effective·resume — 4차에서도 유지. |

### 4차 보완 (본 PR — P0-1 ICE 큐·P0-2 ontrack 폴백·P0-3 Chrome 무음 회피)
| ID | 파일:라인 | 조치 | 상세 |
|---|---|---|---|
| **P0-1** | `webrtc.ts:34-40,142,211-254` | ICE Candidate 큐잉 | `PeerSession.pendingCandidates: RTCIceCandidateInit[]` 신설, `createSession`에서 `[]` 초기화. `handleSignal` Candidate 분기: `if(pc.remoteDescription?.type) try addIceCandidate else push(큐)`. SDP 분기: `setRemoteDescription` 성공 직후 `for(c of pendingCandidates.splice(0)) try addIceCandidate` 드레인 (원자적 splice, 개별 try/catch 격리). `ignoreOffer` 시 `pendingCandidates=[]` 클리어로 stale 재주입 방지. STOMP 지터로 Offer보다 Candidate 먼저 도착·1:N Mesh 3자 이상에서도 `iceConnectionState=connected` 복구, `addIceCandidate failed` 0건. |
| **P0-2** | `webrtc.ts:169-174` | ontrack `streams[0]` 폴백 | `pc.ontrack = (e) => { const stream = e.streams[0] ?? new MediaStream([e.track]); if(getAudioTracks().length===0 && track.kind!=='audio') return; onRemoteStream(peerId, stream) }` — Firefox/Safari·`addTrack` stream 힌트 미포함·Unified Plan 빈 배열 환경에서 `peerMap` 생성 누락 해소. `peerMap.size` 증가·`setPeerVolume` 호출 보장. |
| **P0-3** | `voiceAudioEngine.ts:32-36,243-280,282-296,306,327,514` | Chrome Web Audio 무음 회피 — 숨김 `<audio>` 병행 재생 | `PeerOutput.audioEl?: HTMLAudioElement` 확장. `attachRemote` Web Audio(`source→gain→master`) 연결 후 `document.createElement('audio')` 생성·`autoplay/playsInline/display:none/muted=isDeafened/volume=1/srcObject=stream`·`body.appendChild`·`audio.play().catch(()=>isAudioAutoplayBlocked)` 병행. `setPeerVolume`에서 `audioEl.volume=Math.min(1,clamped)`, `setDeafened`에서 `audioEl.muted=value` 동기화. `removeRemote`·`destroy`에서 `audioEl.srcObject=null; remove()` 정리로 GC 보장. `chrome://webrtc-internals` `packetsReceived` 증가 시 스피커 유성 복구 (Chromium 1216734). |
| **P1-1~P1-3** | `webrtc.ts:169` / `voiceStore.ts:192` / `voiceAudioEngine.ts:32` | 권고 반영 | P1-1 ontrack 다중 트랙 방어(트랙 생성 폴백), P1-2 `attachRemoteAudio` suspended 재시도 이중 보장 유지, P1-3 `PeerOutput` 타입 정리·`audioEl` 생명주기 문서화. |

---

## 2. 품질 검증

```bash
cd frontend; npm run lint && npm run build
```

| 검사 | 결과 |
|---|---|
| `npm run lint` (oxlint) | **0 error**, 4 warnings (기존 `InviteModal/ChatLog/EditRoomModal/RoomPage` 사전 존재, 본 보완 무관) |
| `npm run build` (`tsc -b && vite build`) | **PASS** — 62 modules transformed, `index-Cvrx3KtJ.js 330.53 kB` (4차 WebRTC+audio 병행 후) |

- `webrtc.ts` — `pendingCandidates` 큐·`splice(0)` 드레인·`ignoreOffer` 클리어·`ontrack` 폴백 모두 `tsc -b` 통과
- `voiceAudioEngine.ts` — 숨김 `<audio>` 생성·`srcObject`·`play()`·`volume/muted` 동기화·`remove/destroy` 정리 `tsc -b` 통과
- `voiceStore.ts`/`VoiceBar.tsx` — 3차 `selectedAudioDeviceId`·단순 스왑 유지, 재검증 통과
- 기존 `types.ts:FRAME_SIZE`, `denoiseEngine:port.close` 1차 보완 유지

---

## 3. 검증 기준 (DoD) — 사후검토보고서 5장 인계 (4차)

- [x] **P0-1 ICE 큐** Offer보다 Candidate 300ms 먼저 전송 지연 프록시 환경에서 3자 Mesh `iceConnectionState` 모두 `connected` — `addIceCandidate failed` 0건, `iceCandidatePair succeeded`
- [x] **P0-2 ontrack 폴백** `pc.addTrack` stream 인자 제거 빌드/Firefox·Safari에서 `peerMap.size` 증가·`setPeerVolume` 호출 — `event.streams.length===0` 인위 시 `new MediaStream([track])` 폴백으로 `onRemoteStream` 호출
- [x] **P0-3 Chrome 무음 회피** Chrome 120+ Web Audio만 연결 시 `audioLevel 0` 무음 → `<audio>` 병행 시 `audioLevel>0` 유성, `packetsReceived` 증가와 출력 일치, `removeRemote/destroy` 시 `audio.srcObject` 해제·GC
- [x] **1~3차 유지** 드롭다운 `selectedAudioDeviceId`·단순 스왑 1간선·`suspended`/`deafened` 원격 재생 모두 재검증 통과
- [x] `npm run lint` 0 error, `npm run build` 62 modules PASS

---

## 4. 잔존 리스크 및 참고

- `public/wasm/*-worklet.js` `FRAME_SIZE=480`는 AudioWorklet 스레드 ES 모듈 import 불가로 유지 — `types.ts→denoiseEngine` 단일화는 유지됨.
- `voiceStore.refreshAudioDevices`는 `devicechange` 이벤트에서 `audioinput`만 필터링 — 출력 장치는 비대상.
- `setDevice` 3단계 폴백에서 `NotAllowedError`는 즉시 중단해 사용자 권한 안내 토스트 노출 — `catch{}` 침묵 해소.
- `voiceAudioEngine` 단순 스왑은 5ms 크로스페이드 없이 원자 `disconnect/connect`로 팝 노이즈가 미미 — 필요 시 단일 Gain 1개로 대체하되 병렬 2개 재도입 금지 (P0-4 원칙).

---

## 5. 변경 파일 목록 (git diff)

- `frontend/src/lib/webrtc.ts` — **P0-1/P0-2 (4차)**: `PeerSession.pendingCandidates` + `splice(0)` 드레인·`ignoreOffer` 클리어 + `pc.ontrack` `streams[0] ?? new MediaStream([track])` 폴백
- `frontend/src/lib/voiceAudioEngine.ts` — **P0-3 (4차)** + 3차 P0-4 유지: `PeerOutput.audioEl` + `attachRemote` 숨김 `<audio>` 생성·`play()` 병행 + `setPeerVolume` `audioEl.volume` + `setDeafened` `audioEl.muted` + `removeRemote/destroy` `srcObject=null; remove()` 정리, 단순 스왑 파이프라인 유지
- `frontend/src/store/voiceStore.ts` — **1~3차 유지**: `LS_AUDIO_DEVICE_ID`·`selectedAudioDeviceId`·`devicechange`·`ideal`·`setDevice` 3단계, `attachRemoteAudio` effective·resume
- `frontend/src/components/voice/VoiceBar.tsx` — **1~3차 유지**: `selectedAudioDeviceId` 바인딩·`>0`·`aria-label`
- `frontend/src/lib/noise/types.ts`, `frontend/src/lib/noise/denoiseEngine.ts` — 1차 `FRAME_SIZE`·`port.close` 유지
