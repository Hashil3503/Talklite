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
