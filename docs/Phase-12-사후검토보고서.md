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
