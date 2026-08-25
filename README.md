# 🎙️ Talklite — 온디맨드 게이머 즉석 파티 매칭 & 오픈 보이스 플랫폼

<div align="center">

![Spring Boot](https://img.shields.io/badge/Spring_Boot-3.5.0-6DB33F?style=for-the-badge&logo=spring-boot&logoColor=white)
![React](https://img.shields.io/badge/React-19.0.0-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7.x-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![MariaDB](https://img.shields.io/badge/MariaDB-11.x-003545?style=for-the-badge&logo=mariadb&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![WebRTC](https://img.shields.io/badge/WebRTC-P2P_Mesh-333333?style=for-the-badge&logo=webrtc&logoColor=white)
![Tests](https://img.shields.io/badge/Tests-30%2F30_PASS-success?style=for-the-badge)

<p>
  <strong>친구 추가나 서버 가입 없이 게임명과 커스텀 해시태그로 즉석 파티를 매칭하고,</strong><br>
  <strong>실시간 텍스트 채팅과 WebRTC 1:N 그룹 음성 통화를 즐기는 차세대 온디맨드 게이밍 플랫폼</strong>
</p>

</div>

---

## 🌟 핵심 특징 (Key Features)

- ⚡ **즉석 온디맨드 매칭**: 복잡한 회원가입 없이 익명 UUID 기반으로 즉시 파티 생성 및 참여
- 🔍 **초고속 마이크로초 검색**: Redis Set `SINTER` 역색인 기반 다중 해시태그 교집합 검색
- 🛡️ **원자적 동시성 제어**: Redis Lua Script (`join.lua`, `gc.lua`, `destroy.lua`) 기반 경쟁 상태(Race Condition) 100% 차단
- 🎙️ **선택적 WebRTC Mesh 음성 (Opt-in Voice)**:
  - 1:N P2P Mesh 오디오 통화 (최대 6인)
  - 브라우저 내장 DSP(AEC 음향 에코 캔슬러, 노이즈 억제, 자동 게인 AGC) 활성화로 2중 울림/루프백 원천 차단
  - Web Audio API (`AnalyserNode`) 기반 실시간 발화자 감지 (Talking Ring 녹색 링 UI)
  - Google 공용 STUN 서버(`stun.l.google.com:19302`) 연동으로 안정적인 NAT/방화벽 통과
- 👑 **방장 권한 및 영구 보존**:
  - `localStorage` 기반 익명 식별자 영구 유지로 브라우저를 재부팅해도 자신이 만든 방의 방장(`👑`) 권한 영구 유지
  - 방장 전용 명시적 방 삭제/폭파 API (`DELETE /api/rooms/{id}`) 및 실시간 `ROOM_DESTROYED` 강제 퇴장
  - 체류 시간(ZSet) 기반 방장 자동 승계 및 방장 강퇴(임시 10분 밴 / 영구 밴)
- 🔄 **세션 자가 치유 (Self-Healing Auth)**:
  - 서버 재기동 또는 Redis 초기화 시 만료된 유령 토큰(Ghost Token)을 감지하여 웹소켓 인증 오류 시 자동 재발급 및 무중단 재연결
- 💾 **이중 라이프사이클 (휘발성 vs 영구 방)**:
  - **임시(휘발성) 방**: 마지막 인원 퇴장 즉시 자동 소멸 (Room GC)
  - **영구 방**: MariaDB `permanent_room` 테이블에 메타데이터 영속화 및 서버 기동 시 `RoomRehydrator` 자동 복원

---

## 🏗️ 아키텍처 (Architecture)

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

---

## 🛠️ 기술 스택 (Tech Stack)

| 분야 | 기술 | 버전 | 설명 |
| :--- | :--- | :---: | :--- |
| **Frontend** | React · TypeScript · Vite | 19.x / 5.x / 7.x | 모바일 우선 반응형 SPA |
| **State & UI** | Zustand · TailwindCSS 4 · TanStack Virtual | 5.x / 4.x / 3.x | 전역 상태 관리 & 가상화 리스트 |
| **Backend** | Spring Boot · Java (LTS) | 3.5.x / 21 | RESTful API & STOMP 메시지 브로커 |
| **Realtime** | Spring WebSocket (STOMP) · Spring Data Redis | Boot 3.5 | Relay-Only Pub/Sub 실시간 브로드캐스트 |
| **In-Memory** | Redis | 7.x | SINTER 태그 검색, Lua 원자 스크립트, Pub/Sub |
| **Database** | MariaDB | 11.x | 영구 방 메타데이터 영속화 |
| **Media** | WebRTC · Web Audio API | Browser Native | 1:N Mesh 음성 통화, DSP 에코 캔슬러, RMS 발화자 감지 |
| **Infra** | Docker Compose | Standard | Redis & MariaDB 통합 컨테이너 런타임 |

---

## 🚀 빠른 시작 (Quick Start)

### 1. 원클릭 실행 (추천)
Windows 환경에서는 프로젝트 루트의 **`start.bat`** 파일을 더블 클릭(또는 실행)하면 Docker 컨테이너, 백엔드, 프론트엔드, ngrok이 한 번에 자동 기동됩니다:

```bash
# 전체 서비스 일괄 기동 (Docker + Spring Boot + Vite + ngrok)
.\start.bat

# 전체 서비스 일괄 안전 종료
.\stop.bat
```

### 2. 수동 실행
```bash
# 1) Docker 인프라 기동 (Redis & MariaDB)
docker compose up -d

# 2) 백엔드 기동 (Spring Boot: 8080)
cd backend
.\mvnw.cmd spring-boot:run

# 3) 프론트엔드 기동 (Vite: 5173)
cd frontend
npm install
npm run dev
```

- **웹 애플리케이션 접속:** `http://localhost:5173`
- **백엔드 REST API:** `http://localhost:8080`
- **ngrok 터널 상태:** `http://127.0.0.1:4040`

---

## 🧪 테스트 및 품질 검증 (Test Suite)

Talklite는 Redis DB 1번 분리 격리 및 자동 Teardown 환경에서 **30개 전체 통합 테스트 스위트 100% PASS**를 달성했습니다:

```bash
# 백엔드 전체 회귀 테스트 실행 (30/30 ALL PASS)
cd backend
.\mvnw.cmd test

# 프론트엔드 타입 검사 및 린트 (0 error)
cd frontend
npm run build && npm run lint
```

| 테스트 클래스 | 테스트 수 | 검증 대상 요구사항 | 결과 |
| :--- | :---: | :--- | :---: |
| `RoomConcurrencyIntegrationTest` | 1 | 50명 동시 입장 시 Lua 원자적 정원 초과 차단 (T-01) | **PASS** |
| `RoomGcIntegrationTest` | 3 | 마지막 인원 퇴장 즉시 파기 및 동시성 2중 가드 (T-02) | **PASS** |
| `SearchApiIntegrationTest` | 5 | 게임명/다중 태그 SINTER 검색, 최신순 정렬, 비공개 방 배제 (T-03) | **PASS** |
| `HostMigrationIntegrationTest` | 1 | 방장 퇴장 시 ZSet 기준 최장 체류자 방장 자동 승계 (T-04) | **PASS** |
| `PermanentRoomPersistenceIntegrationTest` | 1 | 영구 방 MariaDB 영속화 및 RoomRehydrator 자동 복원 (T-06) | **PASS** |
| `KickApiIntegrationTest` | 4 | 방장 권한 강퇴 (임시 10분 밴 / 영구 밴 / 음성 퇴장 연동) (T-07) | **PASS** |
| `ChatRealtimeIntegrationTest` | 2 | STOMP 채팅 실시간 브로드캐스트 & 클라이언트 ID 에코 (T-08) | **PASS** |
| `InviteAndAuthIntegrationTest` | 4 | 비공개 방 6자리 초대코드 발급 및 STOMP 보안 인가 (T-09) | **PASS** |
| `RoomDeletionIntegrationTest` | 4 | 방장 영구 방 명시적 삭제, 비방장 403 차단, 폭파 강제 소멸 (T-10) | **PASS** |
| `SignalRealtimeIntegrationTest` | 4 | WebRTC 시그널링 Offer/Answer/ICE 타겟 중계 및 발화자 브로드캐스트 | **PASS** |
| `PerformanceLatencyIntegrationTest` | 1 | 500개 병렬 동시 요청 원자적 정원 가드 & 평균 지연 <= 200ms | **PASS** |
| **합계** | **30** | **T-01 ~ T-10 전체 시나리오 및 성능/품질 전수 검증** | **100% ALL PASS** |

---

## 📂 프로젝트 구조 (Project Structure)

```
Talklite/
├── backend/                             # Spring Boot 3.5 백엔드
│   ├── src/main/java/com/talklite/
│   │   ├── auth/                        # 익명 세션 토큰 서비스 & WebSocket 인터셉터
│   │   ├── config/                      # WebSocket STOMP, Redis, WebMvc 설정
│   │   ├── realtime/                    # Redis Pub/Sub 발행/구독 메시징
│   │   ├── room/                        # 방 도메인, 서비스, 컨트롤러, MariaDB 영속화
│   │   ├── search/                      # SINTER 다중 태그 교집합 검색 엔진
│   │   ├── signaling/                   # WebRTC 시그널링 & 발화자 브로드캐스트
│   │   └── voice/                       # 음성 참여/퇴장 관리
│   └── src/main/resources/scripts/      # Redis Lua Scripts (join.lua, gc.lua, destroy.lua)
├── frontend/                            # React 19 + TypeScript + Vite 프론트엔드
│   ├── src/
│   │   ├── components/                  # 로비, 방, 채팅, VoiceBar, TalkingRing UI
│   │   ├── lib/                         # WebRTC Manager, Web Audio DSP, STOMP 싱글턴
│   │   ├── store/                       # Zustand 전역 스토어 (lobby, room, voice)
│   │   └── pages/                       # LobbyPage, RoomPage
├── docker-compose.yml                   # Redis 7 & MariaDB 11 컨테이너 오케스트레이션
├── start.bat / start.ps1                # 전체 서비스 원클릭 기동 스크립트
└── stop.bat / stop.ps1                  # 전체 서비스 원클릭 안전 종료 스크립트
```

---

<div align="center">
  <sub>Built with ❤️ by Google Antigravity & Pair Programming</sub>
</div>