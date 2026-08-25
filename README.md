# 🎙️ Talklite — 온디맨드 게이머 파티 매칭 & 오픈 보이스 플랫폼

<div align="center">

![Spring Boot](https://img.shields.io/badge/Spring_Boot-3.5.0-6DB33F?style=for-the-badge&logo=spring-boot&logoColor=white)
![React](https://img.shields.io/badge/React-19.0.0-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7.x-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![MariaDB](https://img.shields.io/badge/MariaDB-11.x-003545?style=for-the-badge&logo=mariadb&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![WebRTC](https://img.shields.io/badge/WebRTC-P2P_Mesh-333333?style=for-the-badge&logo=webrtc&logoColor=white)
![Tests](https://img.shields.io/badge/Tests-30%2F30_PASS-success?style=for-the-badge)

</div>

## ⚡ TL;DR

> **친구 추가도, 서버 가입도 없이** 게임명과 커스텀 해시태그로 3초 만에 파티를 찾고 바로 음성 통화.
> Redis Lua Script 원자 연산으로 **500개 병렬 동시 입장에서 정원 초과 0건**을 보장하고,
> WebRTC P2P Mesh 아키텍처로 **서버 미디어 릴레이 비용 0원**의 그룹 보이스를 구현했습니다.

---

## 📌 Overview (프로젝트 개요)

게임을 하다 보면 "지금 당장 같이 할 사람"이 필요하지만, 기존 디스코드·커뮤니티 방식은 **서버 가입 → 채널 탐색 → 초대 대기**라는 마찰이 큽니다.

Talklite는 이 마찰을 제거한 **온디맨드(On-demand) 파티 매칭 & 오픈 보이스 플랫폼**입니다:

- **익명 UUID 기반 즉시 참여** — 회원가입 절차 없이 브라우저만으로 파티 생성/입장
- **해시태그 교집합 검색** — `#trio #fps` 처럼 다중 조건으로 원하는 파티를 즉시 필터링
- **Opt-in 음성 통화** — 방에 들어와도 원할 때만 마이크를 켜는 1:N 그룹 보이스
- **휘발성/영구 방 이중 라이프사이클** — 일회성 파티는 자동 소멸, 클랜 방은 영속 운영

---

## 🌟 Key Highlights (핵심 구현)

### 1️⃣ Atomic Room Operations (Lua 기반 원자적 동시성 제어)
정원 경쟁(Race Condition)은 분산 환경의 고전적 문제입니다. Talklite는 입장(`join.lua`)·파괴 GC(`gc.lua`)·강제 삭제(`destroy.lua`) 3종의 Lua Script로 **조건 검사와 상태 변경을 Redis 단일 스레드 안에서 원자 처리**합니다.
→ 검증: 500개 병렬 Join 요청에서 정확히 정원 수만큼만 성공, 나머지 전부 409 반환 (`PerformanceLatencyIntegrationTest`)

### 2️⃣ Ultra-fast Tag Search (SINTER 역색인)
태그·게임명을 Redis Set 역색인(`tag:{tag}:rooms`, `game:{game}:rooms`)으로 관리하고, 다중 해시태그 검색은 `SINTER` 교집합 한 번으로 해결합니다. 최신순 정렬은 ZSet 체류 시간 기반으로 O(log N)에 처리합니다.

### 3️⃣ P2P Voice Mesh with Browser DSP (서버 비용 0원)
- WebRTC 1:N Mesh 토폴로지 (최대 6인) — 미디어는 피어 간 직접 전송, 서버는 STOMP 시그널링 중계만 담당
- Perfect Negotiation 패턴 + Google 공용 STUN으로 NAT/방화벽 통과
- 브라우저 내장 DSP(AEC 에코 캔슬링 · 노이즈 억제 · AGC) 강제 활성화로 루프백/겹울림 원천 차단
- Web Audio API `AnalyserNode` RMS 기반 실시간 발화자 감지 (Talking Ring UI)

### 4️⃣ Dual Lifecycle & Self-Healing Auth
- **휘발성 방**: 마지막 인원 퇴장 즉시 메타·멤버·초대코드·역색인까지 Lua로 완전 파기 (Room GC)
- **영구 방**: MariaDB 영속화 + 서버 기동 시 `RoomRehydrator` 자동 복원, 방장 권한 localStorage 영구 유지
- **Self-Healing 인증**: Redis 초기화 등으로 세션이 유실되어도 유령 토큰(Ghost Token)을 감지 → 자동 재발급 → 무중단 WebSocket 재연결

---

## 🏗️ Architecture (아키텍처)

```
[ Frontend (React 19 + Vite 7) ]
   │
   ├─ REST API (/api/*) ───────▶ [ Spring Boot 3.5 Backend ]
   │                                  │
   ├─ STOMP WebSocket (/ws) ──────────┤
   │                                  ├─▶ [ Redis 7 ] (Hash/Set/Lua/PubSub - 인메모리 & 동시성)
   │                                  │
   │                                  └─▶ [ MariaDB 11 ] (영구 방 메타데이터 영속화)
   │
   └─ WebRTC P2P Mesh (Voice) ──▶ [ Peer ↔ Peer (Google STUN) ]
```

**Relay-Only 규약**: 모든 실시간 이벤트는 Redis Pub/Sub 채널로만 발행되고, STOMP 브로드캐스트는 `RedisMessageSubscriber`가 단독 수행합니다. 이 단일 경로 설계로 이중 발송 버그를 구조적으로 차단했습니다.

---

## 🛠️ Tech Stack (기술 스택)

### Frontend
| 분야 | 기술 | 버전 | 설명 |
| :--- | :--- | :---: | :--- |
| **Framework** | React · TypeScript · Vite | 19.x / 5.x / 7.x | 반응형 SPA 프레임워크 & 빌드 |
| **State** | Zustand | 5.x | 전역 상태 관리 (room/voice/lobby) |
| **Styling** | TailwindCSS 4 | 4.x | 유틸리티 기반 스타일링 |
| **Virtualization** | TanStack Virtual | 3.x | 채팅 리스트 가상화로 렌더 최적화 |
| **Realtime** | STOMP.js | 7.x | STOMP over WebSocket 클라이언트 |
| **Media** | WebRTC · Web Audio API | Browser Native | P2P Mesh 음성, DSP, 발화자 감지 |

### Backend & Infra
| 분야 | 기술 | 버전 | 설명 |
| :--- | :--- | :---: | :--- |
| **Framework** | Spring Boot · Java (LTS) | 3.5.x / 21 | REST API & STOMP 메시지 브로커 |
| **Realtime** | Spring WebSocket (STOMP) · Spring Data Redis | Boot 3.5 | Relay-Only Pub/Sub 브로드캐스트 |
| **Store** | Redis | 7.x | SINTER 검색, Lua 원자 스크립트, Pub/Sub |
| **Database** | MariaDB | 11.x | 영구 방 메타데이터 영속화 |
| **Infra** | Docker Compose | Standard | Redis & MariaDB 통합 런타임 |

---

## 💡 Technical Decisions (기술적 선택과 이유)

- **Realtime Store: Redis 7 (Hash/Set/ZSet + Lua)** — 방 메타는 Hash, 멤버는 Set, 체류시간은 ZSet, 검색은 Set 역색인으로 모델링. `SINTER`로 다중 태그 교집합을 O(N) 탐색 없이 처리하고, `join / gc / destroy`를 Lua Script로 원자화해 애플리케이션 락 없이 500 병렬 입장에서도 정원 초과 0건을 보장. 500 병렬 입장 부하 테스트에서 평균 < 200ms, p95(상위 95% 요청) < 500ms 달성.
- **Realtime Transport: STOMP over WebSocket + Redis Pub/Sub Relay-Only** — Spring STOMP Simple Broker만으로는 멀티 인스턴스 브로드캐스트가 불가능해, 발행은 `RedisMessagePublisher` 단일 경로로만 수행하고 구독은 `RedisMessageSubscriber`가 STOMP로 중계하는 구조로 설계. 이중 발송/로컬 누수 버그를 아키텍처 레벨에서 차단.
- **Frontend State: Zustand vs Redux** — 보이스 세션(WebRTC Manager, AudioContext)과 같이 React 외부에서 살아있는 객체를 전역으로 관리해야 해서, 보일러플레이트가 적고 외부 스토어 구독이 자유로운 Zustand(5.x)를 선택. `roomStore`·`voiceStore`·`lobbyStore` 3개로 관심사 분리, 불필요한 리렌더 최소화.
- **Voice: WebRTC P2P Mesh vs SFU** — 6인 이하 소규모 파티가 타깃이라 서버 미디어 릴레이가 불필요한 Mesh가 비용·지연·구현 복잡도에서 유리. Perfect Negotiation 패턴으로 Offer/Answer 충돌을 해결하고, `echoCancellation / noiseSuppression / autoGainControl`을 강제 활성화해 별도 서버 없이도 에코·겹울림을 제거. STUN은 Google 공용 서버로 NAT 통과.
- **Persistence: MariaDB (permanent_room) vs Redis Only** — 휘발성 방은 Redis에만 두고 GC로 즉시 파기해 메모리를 가볍게 유지, 영구 방만 MariaDB에 영속화해 서버 재기동 후 `RoomRehydrator`로 복원. 전체 방을 RDB에 넣으면 TTL·GC·SINTER 성능 이점을 잃는다고 판단해 하이브리드 라이프사이클로 분리.

---

## 🧪 Test & Quality (테스트 및 품질)

Redis DB 격리 + 자동 Teardown 환경에서 **30개 통합 테스트 100% PASS**, 프론트엔드 타입체크/린트 0 error를 유지합니다.

```bash
# 백엔드 전체 회귀 테스트 (30/30 ALL PASS)
cd backend && .\mvnw.cmd test

# 프론트엔드 빌드 및 린트 (0 error)
cd frontend && npm run build && npm run lint
```

| 테스트 클래스 | 수 | 검증 대상 | 결과 |
| :--- | :---: | :--- | :---: |
| `RoomConcurrencyIntegrationTest` | 1 | 50명 동시 입장 Lua 원자적 정원 차단 (T-01) | ✅ |
| `RoomGcIntegrationTest` | 3 | 마지막 퇴장 즉시 파기 + 동시성 2중 가드 (T-02) | ✅ |
| `SearchApiIntegrationTest` | 5 | SINTER 다중 태그 검색·정렬·비공개 배제 (T-03) | ✅ |
| `HostMigrationIntegrationTest` | 1 | ZSet 기반 방장 자동 승계 (T-04) | ✅ |
| `PermanentRoomPersistenceIntegrationTest` | 1 | MariaDB 영속화 + Rehydrator 복원 (T-06) | ✅ |
| `KickApiIntegrationTest` | 4 | 강퇴·임시 10분 밴·영구 밴 (T-07) | ✅ |
| `ChatRealtimeIntegrationTest` | 2 | STOMP 채팅 브로드캐스트 & ID 에코 (T-08) | ✅ |
| `InviteAndAuthIntegrationTest` | 4 | 6자리 초대코드 & STOMP 보안 인가 (T-09) | ✅ |
| `RoomDeletionIntegrationTest` | 4 | 방 폭파·비방장 403·강제 소멸 (T-10) | ✅ |
| `SignalRealtimeIntegrationTest` | 4 | Offer/Answer/ICE 타겟 중계·발화자 브로드캐스트 | ✅ |
| `PerformanceLatencyIntegrationTest` | 1 | 500 병렬 요청 정원 가드 & 평균 지연 ≤ 200ms | ✅ |

---

## 🚀 Quick Start (실행 방법)

### 원클릭 실행 (Windows 추천)
```bash
.\start.bat   # Docker + Spring Boot + Vite + ngrok 일괄 기동
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

- **웹 앱:** `http://localhost:5173` · **REST API:** `http://localhost:8080` · **ngrok:** `http://127.0.0.1:4040`

---

## 📂 Project Structure (프로젝트 구조)

```
Talklite/
├── backend/                             # Spring Boot 3.5 백엔드
│   ├── src/main/java/com/talklite/
│   │   ├── auth/                        # 익명 세션 토큰 & WebSocket 인터셉터
│   │   ├── config/                      # WebSocket STOMP, Redis 설정
│   │   ├── realtime/                    # Redis Pub/Sub 발행/구독 메시징
│   │   ├── room/                        # 방 도메인, 서비스, MariaDB 영속화
│   │   ├── search/                      # SINTER 다중 태그 검색 엔진
│   │   ├── signaling/                   # WebRTC 시그널링 중계
│   │   └── voice/                       # 음성 참여/퇴장 관리
│   └── src/main/resources/scripts/      # Redis Lua Scripts (join/gc/destroy)
├── frontend/                            # React 19 + TypeScript + Vite
│   └── src/
│       ├── components/                  # 로비, 방, 채팅, VoiceBar UI
│       ├── lib/                         # WebRTC Manager, Audio DSP, STOMP 싱글턴
│       ├── store/                       # Zustand 전역 스토어
│       └── pages/                       # LobbyPage, RoomPage
├── docker-compose.yml                   # Redis 7 & MariaDB 11 오케스트레이션
└── start.bat / stop.bat                 # 원클릭 기동/종료 스크립트
```

---

<div align="center">
  <sub>Solo-built with ❤️ — Talklite</sub>
</div>
