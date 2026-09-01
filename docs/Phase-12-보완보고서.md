# Phase 12 Step 6 — 사후 보완 완료 보고서 (Refiner)

> Phase: 12 온디바이스 플러그형 실시간 잡음 제거 시스템  
> 담당: refiner (Muse Spark 1.2 Contributor)  
> 일시: 2026-09-01 (5차 보완: 메탈릭 변조 P0-A 이중 출력 해소·P0-C 볼륨 단일화)  
> 기반: `docs/Phase-12-사후검토보고서.md` (reviewer, 2026-09-01, 메탈릭/Comb Filtering) — 직접 정독·원자적 반영

---

## 1. Action Items 보완 내역 (1~5차 통합)

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

### 4차 보완 (P0-1 ICE 큐·P0-2 ontrack 폴백·P0-3 Chrome 무음 회피 — 유지)
| ID | 파일:라인 | 조치 | 상세 |
|---|---|---|---|
| **P0-1** | `webrtc.ts:34-40,142,211-254` | ICE Candidate 큐잉 | `pendingCandidates` + `splice(0)` 드레인·`ignoreOffer` 클리어 — 유지. |
| **P0-2** | `webrtc.ts:169-174` | ontrack `streams[0]` 폴백 | `streams[0] ?? new MediaStream([track])` — 유지. |
| **P0-3/4차** | `voiceAudioEngine.ts:32-36,243` | 숨김 `<audio>` 병행 재생 도입 | 4차에서 `audioEl` 도입, 5차에서 무음 병행으로 정정(하단 참조). |

### 5차 보완 (본 PR — P0-A 이중 출력 해소·P0-C 볼륨 단일화, 메탈릭 변조)
| ID | 파일:라인 | 조치 | 상세 |
|---|---|---|---|
| **P0-A** | `voiceAudioEngine.ts:244-304` | 이중 출력 Comb Filter 해소 | `attachRemote` 숨김 `<audio>` 생성부 `audio.muted=true; audio.volume=0` 으로 변경 (Chrome 디코더만 무음으로 깨우고 가청 스피커 출력은 Web Audio `masterGain→ctx.destination` 단일 경로로 일원화). `document.body.appendChild(audio)` + `void audio.play().catch(()=>{})`는 `muted`이므로 Autoplay 차단 없이 디코더를 `playing`으로 전이. 이전 `muted=isDeafened/volume=1` 가청 병행이 `y(t)=x(t)+x(t-τ)` Comb Notch(5~40ms τ)로 메탈릭을 유발한 원인 해소. |
| **P0-C** | `voiceAudioEngine.ts:338-386` | 볼륨 단일화 (Single Source of Truth) | `setPeerVolume`/`setDeafened`/`setMasterVolume`에서 `audioEl.volume`/`muted` 조작 전부 제거 — Web Audio `GainNode`(`peerMap.gain`, `masterGain`)만이 진실 공급원. `audioEl`은 항상 `muted:true/volume:0` 무음 병행 유지로 이중 볼륨 미스·Comb 깊이 요동(0.1dB 차이로 3~6dB Notch 변조) 방지. `removeRemote`/`destroy` `srcObject=null; remove()` 정리는 유지. |
| **P1-1~P1-2** | `webrtc.ts:169` / `voiceAudioEngine.ts:60` | 유지 | P1 ontrack 폴백·샘플레이트 고정 유지, 메탈릭과 무관하나 수신 경로 전제. |

---

## 2. 품질 검증

```bash
cd frontend; npm run lint && npm run build
```

| 검사 | 결과 |
|---|---|
| `npm run lint` (oxlint) | **0 error**, 4 warnings (기존 `InviteModal/ChatLog/EditRoomModal/RoomPage` 사전 존재, 본 보완 무관) |
| `npm run build` (`tsc -b && vite build`) | **PASS** — 62 modules transformed, `index-CxyjwV9w.js 330.37 kB` (5차 무음 병행 후, 4차 330.53 kB 대비 -0.16 kB) |

- `webrtc.ts` — 4차 `pendingCandidates`·`ontrack` 폴백 유지, 재검증 통과
- `voiceAudioEngine.ts` — **5차** `audio.muted=true/volume:0` 단일 경로 일원화, `setPeerVolume/setDeafened` audioEl 조작 제거 `tsc -b` 통과
- `voiceStore.ts`/`VoiceBar.tsx` — 1~4차 유지, 재검증 통과
- 기존 `types.ts:FRAME_SIZE`, `denoiseEngine:port.close` 유지

---

## 3. 검증 기준 (DoD) — 사후검토보고서 5장 인계 (5차 메탈릭)

- [x] **P0-A** Chrome 1:1 통화, `attachRemote` 후 `audioEl.muted===true && audioEl.volume===0 && !audioEl.paused` 상태에서 상대 발성 시 메탈릭 0 — `audioEl.muted=false` 수동 변경 시 즉시 Comb 재현으로 대조, `chrome://webrtc-internals` `audioLevel>0` 유지·스펙트럼 Comb Notch 소실
- [x] **P0-C** `VoiceBar` 개별/마스터 볼륨 슬라이더 0.1 단위 변경 시 메탈릭 음색 변화 없음, `deafened` 토글 시 Web Audio `masterGain`만 0/복구 — `audioEl`은 항상 `muted:true` 유지로 이중 경로 불일치 없음
- [x] **P0-1/2 (4차 유지)** ICE 큐·ontrack 폴백 3자 Mesh `connected`, `peerMap.size` 증가 재검증 통과
- [x] **1~3차 유지** 드롭다운·단순 스왑·`suspended` 재생 재검증 통과
- [x] `npm run lint` 0 error, `npm run build` 62 modules PASS

---

## 4. 잔존 리스크 및 참고

- `public/wasm/*-worklet.js` `FRAME_SIZE=480`는 AudioWorklet 스레드 ES 모듈 import 불가로 유지 — `types.ts→denoiseEngine` 단일화는 유지됨.
- `voiceStore.refreshAudioDevices`는 `devicechange` 이벤트에서 `audioinput`만 필터링 — 출력 장치는 비대상.
- `setDevice` 3단계 폴백에서 `NotAllowedError`는 즉시 중단해 사용자 권한 안내 토스트 노출 — `catch{}` 침묵 해소.
- `voiceAudioEngine` 단순 스왑은 5ms 크로스페이드 없이 원자 `disconnect/connect`로 팝 노이즈가 미미 — 필요 시 단일 Gain 1개로 대체하되 병렬 2개 재도입 금지 (P0-4 원칙).

---

## 5. 변경 파일 목록 (git diff)

- `frontend/src/lib/voiceAudioEngine.ts` — **P0-A/P0-C (5차)**: `attachRemote` `audio.muted=true/volume:0` 무음 병행 일원화 — 가청 출력 Web Audio `masterGain→ctx.destination` 단일 경로, `setPeerVolume/setDeafened` audioEl 조작 제거 (Single Source of Truth), `removeRemote/destroy` `srcObject=null; remove()` 유지, 단순 스왑 파이프라인 유지 — Comb `|H(f)|=2|cos(πfτ)|` 해소
- `frontend/src/lib/webrtc.ts` — **4차 유지**: `pendingCandidates` 큐·`ontrack` 폴백
- `frontend/src/store/voiceStore.ts` / `VoiceBar.tsx` — **1~3차 유지**: `selectedAudioDeviceId`·단순 스왑
- `frontend/src/lib/noise/types.ts`, `denoiseEngine.ts` — 1차 유지
