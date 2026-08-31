# 🎙️ Talklite — 온디맨드 게이머 파티 매칭 & 오픈 보이스 플랫폼

<div align="center">

![Spring Boot](https://img.shields.io/badge/Spring_Boot-3.5.0-6DB33F?style=for-the-badge&logo=spring-boot&logoColor=white)
![React](https://img.shields.io/badge/React-19.0.0-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7.x-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![MariaDB](https://img.shields.io/badge/MariaDB-11.x-003545?style=for-the-badge&logo=mariadb&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![WebRTC](https://img.shields.io/badge/WebRTC-P2P_Mesh-333333?style=for-the-badge&logo=webrtc&logoColor=white)
![Tests](https://img.shields.io/badge/Tests-52%2F52_PASS-success?style=for-the-badge)

</div>

## ⚡ TL;DR

> **친구 추가도, 서버 가입도 없이** 게임명과 커스텀 해시태그로 3초 만에 파티를 찾고 바로 음성 통화.
> Redis Lua Script 원자 연산으로 **500개 병렬 동시 입장에서 정원 초과 0건**을 보장하고,
> WebRTC P2P Mesh 아키텍처로 **서버 미디어 릴레이 비용 0원**의 그룹 보이스와 인터랙티브 채팅을 구현했습니다.

---

## 📌 Overview (프로젝트 개요)

게임을 하다 보면 "지금 당장 같이 할 사람"이 필요하지만, 기존 디스코드·커뮤니티 방식은 **서버 가입 → 채널 탐색 → 초대 대기**라는 마찰이 큽니다.

Talklite는 이 마찰을 제거한 **온디맨드(On-demand) 파티 매칭 & 오픈 보이스 플랫폼**입니다:

- **익명 UUID 기반 즉시 참여** — 회원가입 절차 없이 브라우저만으로 파티 생성/입장
- **해시태그 교집합 검색** — `#trio #fps` 처럼 다중 조건으로 원하는 파티를 즉시 필터링
- **Opt-in 음성 통화** — 방에 들어와도 원할 때만 마이크를 켜는 1:N 그룹 보이스 (최대 6인)
- **정밀 오디오 엔진 & 고급 음성 UX** — 200% 증폭, 피크 컴프레서, 20단계 VU 미터, 3초 루프백 마이크 테스트, PTT & Stuck 방어
- **인터랙티브 채팅 시스템** — 서버 확정 @멘션 및 무에셋 핑 사운드, 클립보드 이미지 WebP 압축 업로드 & 라이트박스
- **동적 방 관리 & 이중 라이프사이클** — 방장 실시간 정보 수정 & 원자 재색인, 일회성 파티 자동 소멸(GC) 및 클랜 방 영속 운영

---

## 🌟 Key Highlights (핵심 구현)

### 1️⃣ Atomic Room Operations (Lua 기반 원자적 동시성 제어)
정원 경쟁(Race Condition)은 분산 환경의 고전적 문제입니다. Talklite는 입장(`join.lua`)·음성 입장(`voice_join.lua`)·파괴 GC(`gc.lua`)·강제 삭제(`destroy.lua`)·방 수정 재색인(`update_room.lua`) 5종의 Lua Script로 **조건 검사와 상태 변경을 Redis 단일 스레드 안에서 원자 처리**합니다.
→ 검증: 500개 병렬 Join 요청에서 정확히 정원 수만큼만 성공, 나머지 전부 409 반환 (`PerformanceLatencyIntegrationTest`)

### 2️⃣ Ultra-fast Tag Search & Dynamic Re-indexing (SINTER 역색인)
- 태그·게임명을 Redis Set 역색인(`tag:{tag}:rooms`, `game:{game}:rooms`)으로 관리하고, 다중 해시태그 검색은 `SINTER` 교집합 한 번으로 해결합니다.
- 모든 태그는 `toLowerCase()` 소문자 정규화 및 중복 제거로 색인 일관성을 보장합니다.
- 방 정보 수정 시 `update_room.lua`가 `oldGame`/`oldTags`를 원자적으로 `SREM`/`SADD` 재색인하여 검색 상태를 실시간 동기화합니다.

### 3️⃣ P2P Voice Mesh with Precision Audio Engine (서버 비용 0원)
- **WebRTC 1:N Mesh 토폴로지 (최대 6인)**: 미디어는 피어 간 직접 전송, 서버는 STOMP 시그널링 중계만 담당
- **Perfect Negotiation 패턴**: Google 공용 STUN으로 NAT/방화벽 통과 및 시그널링 충돌 방지
- **정밀 오디오 파이프라인 (`VoiceAudioEngine`)**:
  - `MediaStreamSource` → `GainNode` (200% 증폭) → `DynamicsCompressorNode` (피크 왜곡 방어) → `AnalyserNode`
  - 참여자별 개별 볼륨(0~200%) & 음소거(Mute), 마스터 볼륨(0~100%), 장치 핫스왑 지원
  - 영구 기억: 브라우저 로컬 스토리지에 참여자 UID별 볼륨 설정 스마트 저장
- **고급 음성 UX & PTT**:
  - 단일 rAF 기반 30fps EMA 스무딩 20단계 VU 레벨 미터
  - 3초 로컬 루프백 마이크 자가 진단 테스트
  - `event.code` 기반 Push-to-Talk (PTT) 및 4중 Stuck Mute 방어 (Window Blur, Visibility Change, 마이크 모드 전환, 언마운트)

### 4️⃣ Interactive Chat System (서버 확정 멘션 & 미디어 전송)
- **서버 확정 @멘션**: 정규식 기반 참여자 닉네임 파싱 및 서버 확정, Web Audio API 무에셋 핑 사운드(880Hz $\rightarrow$ 1760Hz) 합성 재생
- **안전한 이미지 업로드**: 5MB 용량/MIME 검증 REST 엔드포인트 (`POST /api/rooms/{id}/images`), 클립보드 붙여넣기(`Ctrl+V`) 시 Canvas 기반 WebP 0.85 자동 압축 업로드
- **고성능 렌더링 & UX**: TanStack Virtual 가상화 리스트, 이미지 로드 시 동적 높이 재측정, 풀스크린 라이트박스 뷰어

### 5️⃣ Dynamic Room Management & Dual Lifecycle
- **동적 방 수정 (`PATCH /api/rooms/{id}`)**: 방장 권한(403) 및 정원 축소 충돌(409) 검증, `ROOM_UPDATED` 이벤트를 방 내부(`/topic/room/{id}`)와 로비(`/topic/lobby`)로 2중 STOMP 브로드캐스트
- **휘발성 방**: 마지막 인원 퇴장 즉시 메타·멤버·초대코드·역색인까지 Lua로 완전 파기 (Room GC)
- **영구 방**: MariaDB 영속화 + 서버 기동 시 `RoomRehydrator` 자동 복원, 방장 부재 시 고아 상태(`markOrphan`) 전환 후 첫 재입장자에게 방장 권한(`👑`) 자동 승계
- **Self-Healing 인증 & 보안 인가**: Redis 초기화 등으로 세션이 유실되어도 유령 토큰(Ghost Token)을 감지 → 자동 재발급, `@AuthenticatedUser`로 HTTP Bearer 토큰 인가 강제

---

## 🏗️ Architecture (아키텍처)

```
[ Frontend (React 19 + Vite 7) ]
   │
   ├─ REST API (/api/*) ───────▶ [ Spring Boot 3.5 Backend ]
   │  (Auth, Room, Search, Chat Image)│
   │                                  ├─▶ [ Redis 7 ] (Hash/Set/ZSet/Lua/PubSub - 인메모리 & 동시성)
   ├─ STOMP WebSocket (/ws) ──────────┤
   │  (Chat, Signaling, Room Sync)    └─▶ [ MariaDB 11 ] (영구 방 & 대화 기록 영속화)
   │
   └─ WebRTC P2P Mesh (Voice) ──▶ [ Peer ↔ Peer (Google STUN) ]
```

**Relay-Only 규약**: 모든 실시간 이벤트는 Redis Pub/Sub 채널로만 발행되고, STOMP 브로드캐스트는 `RedisMessageSubscriber`가 단독 수행합니다. 이 단일 경로 설계로 이중 발송 및 로컬 브로드캐스트 누수 버그를 구조적으로 차단했습니다.

---

## 🛠️ Tech Stack (기술 스택)

### Frontend
| 분야 | 기술 | 버전 | 설명 |
| :--- | :--- | :---: | :--- |
| **Framework** | React · TypeScript · Vite | 19.x / 5.x / 7.x | 반응형 SPA 프레임워크 & 빌드 |
| **State** | Zustand | 5.x | 전역 상태 관리 (`roomStore`, `voiceStore`, `lobbyStore`) |
| **Styling** | TailwindCSS 4 | 4.x | 모던 유틸리티 기반 스타일링 |
| **Virtualization** | TanStack Virtual | 3.x | 채팅 리스트 가상화로 대규모 대화 렌더 최적화 |
| **Realtime** | STOMP.js | 7.x | STOMP over WebSocket 클라이언트 싱글턴 |
| **Media & Audio** | WebRTC · Web Audio API | Browser Native | P2P Mesh 음성, 200% 증폭 & 피크 컴프레서, VU 미터, 무에셋 핑 합성 |

### Backend & Infra
| 분야 | 기술 | 버전 | 설명 |
| :--- | :--- | :---: | :--- |
| **Framework** | Spring Boot · Java (LTS) | 3.5.x / 21 | REST API & STOMP 메시지 브로커 |
| **Realtime** | Spring WebSocket (STOMP) · Spring Data Redis | Boot 3.5 | Relay-Only Pub/Sub 브로드캐스트 아키텍처 |
| **Store** | Redis | 7.x | SINTER 역색인 검색, 5종 Lua 원자 스크립트, Pub/Sub |
| **Database** | MariaDB | 11.x | 영구 방 메타데이터 및 채팅 기록 영속화 |
| **Infra** | Docker Compose | Standard | Redis 7 & MariaDB 11 통합 컨테이너 환경 |

---

## 💡 Technical Decisions (기술적 선택과 이유)

- **Realtime Store: Redis 7 (Hash/Set/ZSet + Lua)** — 방 메타는 Hash, 멤버는 Set, 체류시간은 ZSet, 검색은 Set 역색인으로 모델링. `SINTER`로 다중 태그 교집합을 O(N) 탐색 없이 처리하고, `join / voice_join / gc / destroy / update_room` 5종 스크립트를 Lua Script로 원자화해 애플리케이션 락 없이 500 병렬 동시 요청에서도 정원 초과 0건을 보장.
- **Realtime Transport: STOMP over WebSocket + Redis Pub/Sub Relay-Only** — Spring STOMP Simple Broker만으로는 멀티 인스턴스 브로드캐스트가 불가능해, 발행은 `RedisMessagePublisher` 단일 경로로만 수행하고 구독은 `RedisMessageSubscriber`가 STOMP로 중계하는 구조로 설계. 이중 발송/로컬 누수 버그를 아키텍처 레벨에서 차단.
- **Frontend State: Zustand vs Redux** — 보이스 세션(WebRTC Manager, AudioContext, VoiceAudioEngine)과 같이 React 외부 라이프사이클을 갖는 객체를 전역으로 관리하기 위해 보일러플레이트가 적고 외부 스토어 구독이 자유로운 Zustand(5.x)를 선택. `roomStore`·`voiceStore`·`lobbyStore` 3개로 관심사 분리.
- **Voice: WebRTC P2P Mesh + Web Audio Engine vs SFU** — 6인 이하 소규모 파티가 타깃이라 서버 미디어 릴레이가 불필요한 Mesh가 비용·지연·구현 복잡도에서 유리. Perfect Negotiation 패턴으로 Offer/Answer 충돌을 해결하고, Web Audio API 파이프라인(Gain 200% + Compressor + Analyser)으로 선명하고 피크 없는 음질 제공.
- **Persistence: MariaDB (permanent_room / chat_message) vs Redis Only** — 일회성 휘발성 방은 Redis에만 두고 GC로 즉시 파기해 메모리를 가볍게 유지, 클랜/영구 방과 대화 기록만 MariaDB에 영속화해 서버 재기동 후 `RoomRehydrator`로 복원하는 하이브리드 라이프사이클 채택.

---

## 🧪 Test & Quality (테스트 및 품질)

Redis DB 격리 + 자동 Teardown 환경에서 **52개 통합 테스트 100% ALL PASS**, 프론트엔드 타입체크/린트 0 error를 유지합니다.

```bash
# 백엔드 전체 회귀 테스트 (52/52 ALL PASS)
cd backend && .\mvnw.cmd test

# 프론트엔드 빌드 및 린트 (0 error)
cd frontend && npm run build && npm run lint
```

| 테스트 클래스 | 테스트 수 | 검증 대상 | 결과 |
| :--- | :---: | :--- | :---: |
| `DefectRemediationIntegrationTest` | 5 | 실전 결함 DEF-01~06 런타임 검증 (인증 강제, 0명 승계, Presence 단절, 6인 Lua 가드, 태그 정규화) | ✅ PASS |
| `SignalRealtimeIntegrationTest` | 3 | WebRTC 시그널링 Offer/Answer/ICE 및 보이스 정원 6인 가드 (FR-VOICE-01~04) | ✅ PASS |
| `HostMigrationIntegrationTest` | 1 | 방장 퇴장 시 ZSet 기준 최고참 방장 승계 (FR-ROOM-05, T-04) | ✅ PASS |
| `InviteAndAuthIntegrationTest` | 4 | 비공개 방 초대코드 발급 및 STOMP CONNECT/SUBSCRIBE 보안 인가 (T-09, NFR-SEC-02) | ✅ PASS |
| `KickApiIntegrationTest` | 4 | 방장 권한 강퇴 (임시 10분 밴 / 영구 밴 / 음성 퇴장 연동) (FR-ROOM-07, T-07) | ✅ PASS |
| `RoomApiIntegrationTest` | 1 | 방 생성, 입장, 퇴장 기본 REST API 흐름 | ✅ PASS |
| `RoomConcurrencyIntegrationTest` | 1 | 50명 동시 입장 시 Lua 정원 원자적 차단 (T-01) | ✅ PASS |
| `RoomDeletionIntegrationTest` | 4 | 방장 영구 방 명시적 삭제, 비방장 403 차단, 부재 방 404, 다중 인원 폭파 강제 소멸 (FR-ROOM-08, T-10) | ✅ PASS |
| `RoomGcIntegrationTest` | 3 | 마지막 인원 퇴장 즉시 파기, 초대코드/역색인 SREM, 동시 입장-퇴장 2중 가드 (T-02) | ✅ PASS |
| `PermanentRoomPersistenceIntegrationTest` | 1 | 영구 방 MariaDB 영속화, 방장 승계 DB 동기화, Re-hydration 복원 (T-06) | ✅ PASS |
| `ChatHistoryIntegrationTest` | 3 | 영구 방 대화 저장, 과거순 조회 복원, Redis 캐시 미스 시 MariaDB 폴백, 방 삭제 시 대화 소멸 (FR-ROOM-03, T-11) | ✅ PASS |
| `RoomUpdateIntegrationTest` | 4 | 방 정보 수정 PATCH, 비방장 403, 정원 축소 409 충돌, 태그 SREM/SADD 원자 재색인 검색 검증 (Phase 11) | ✅ PASS |
| `ComprehensiveAuditIntegrationTest` | 10 | 전체 마일스톤 종합 결함 전수 검증 (인증 경계 401/403, 정원 경합 409, 원자 재색인, 멘션/이메일 오탐 방어) | ✅ PASS |
| `PerformanceLatencyIntegrationTest` | 1 | 500개 병렬 동시 요청 원자적 정원 가드 및 평균 지연 ≤ 200ms (NFR-PERF-01, 03) | ✅ PASS |
| `SearchApiIntegrationTest` | 5 | 게임명/태그 SINTER 검색, 최신순 정렬, 비공개 방 배제 (FR-SEARCH-01~04, T-03) | ✅ PASS |
| `ChatRealtimeIntegrationTest` | 2 | STOMP 채팅 실시간 브로드캐스트 및 clientRequestId 에코 (FR-CHAT-01, T-08) | ✅ PASS |
| **합계** | **52** | **T-01 ~ T-11 전체 시나리오, DEF-01~09, Phase 8~11 및 종합 결함 전수 검증** | **ALL PASS** |

---

## 🚀 Quick Start (실행 방법)

### 원클릭 실행 (Windows 추천)
```bash
.\start.bat   # Docker + Spring Boot + Vite 일괄 기동
.\stop.bat    # 전체 안전 종료
```

### 수동 실행
```bash
# 1) Docker 인프라 기동 (Redis & MariaDB)
docker compose up -d

# 2) 백엔드 기동 (8080)
cd backend && .\mvnw.cmd spring-boot:run

# 3) 프론트엔드 기동 (5173)
cd frontend && npm install && npm run dev
```

- **웹 앱:** `http://localhost:5173` · **REST API:** `http://localhost:8080`

---

## 📂 Project Structure (프로젝트 구조)

```
Talklite/
├── backend/                             # Spring Boot 3.5 백엔드
│   ├── src/main/java/com/talklite/
│   │   ├── auth/                        # 익명 세션 토큰 & @AuthenticatedUser 인가
│   │   ├── chat/                        # @멘션 파싱, 대화 영속화, 이미지 업로드
│   │   ├── config/                      # WebSocket STOMP, Redis, Static Resource 설정
│   │   ├── realtime/                    # Redis Pub/Sub Relay-Only 브로드캐스트
│   │   ├── room/                        # 방 도메인, 동적 수정(PATCH), 강퇴, MariaDB 영속화
│   │   ├── search/                      # SINTER 다중 태그 검색 엔진
│   │   ├── signaling/                   # WebRTC 시그널링 중계 (Offer/Answer/ICE)
│   │   └── voice/                       # 6인 음성 참여 원자 가드 및 발화 상태 관리
│   └── src/main/resources/
│       ├── lua/                         # Redis Lua Scripts (join, voice_join, gc, destroy, update_room)
│       └── scripts/                     # Redis Lua 스크립트 복사본
├── frontend/                            # React 19 + TypeScript + Vite
│   └── src/
│       ├── components/                  # LobbyPage, RoomPage, VoiceBar, ChatLog, EditRoomModal 등
│       ├── lib/                         # WebRTC Manager, VoiceAudioEngine, audioPing, STOMP 싱글턴
│       ├── store/                       # Zustand 전역 스토어 (roomStore, voiceStore, lobbyStore)
│       └── pages/                       # LobbyPage, RoomPage
├── docs/                                # 마일스톤 완료보고서, 설계해석본, 지침서, 인수인계서
├── docker-compose.yml                   # Redis 7 & MariaDB 11 오케스트레이션
└── start.bat / stop.bat                 # 원클릭 기동/종료 스크립트
```

---

<div align="center">
  <sub>Solo-built with ❤️ — Talklite</sub>
</div>
