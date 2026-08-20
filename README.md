# 🎙️ Talklite — 온디맨드 게이머 파티 매칭 & 오픈 보이스 플랫폼

친구 추가/서버 가입 없이 게임명·커스텀 해시태그 기반 즉석 파티 매칭, 텍스트 채팅과 선택적 WebRTC 그룹 음성 통화를 지원하는 온디맨드 매칭 플랫폼 (토크온 + 오픈채팅 + 디스코드 모델).

## 구조
```
Talklite/
├── frontend/   # React 19 + TypeScript + Vite + Zustand + Tailwind 4
└── backend/    # Spring Boot 3.5 + Java 21 + WebSocket(STOMP) + Spring Data Redis + MariaDB
```

SRS / 개발 계획서는 저장소 외부 LLM-Wiki 위키에 보관합니다.
→ `LLM-Wiki/AI-Sessions/wiki/projects/Talklite/` (요구사항 명세서 · 개발 계획서)

## 확정 기술 스택 (설치 환경 기준)
| 분야 | 기술 | 버전 (설치됨) |
| :--- | :--- | :--- |
| 프론트 런타임 | Node.js | 24.x (LTS) |
| 프론트 | React · TypeScript · Vite · Zustand · TailwindCSS · @tanstack/react-virtual · @stomp/stompjs | 19.x / 5.x / 7.x / 5.x / 4.x / 3.x / 7.x |
| 백엔드 | Spring Boot · Java · WebSocket(STOMP) · Spring Data Redis(Lettuce) | 3.5.x / 21 / Boot 동기화 |
| 인메모리 | Redis (Set/SINTER/Lua/PubSub/Key Expiration) | 7.x |
| 영속화 | MariaDB (영구 방 메타데이터) | 11.x (MySQL 호환) |

## 핵심 설계 포인트
- 휘발성 방 마지막 인원 퇴장 즉시 소멸 (Room GC, 삭제 경고 안내) / 영구 방 MariaDB 보존·재입장
- Redis Set `SINTER` 역색인 기반 다중 태그 교집합 검색
- Redis Lua Script 기반 원자적 정원 검증 (동시성 제어)
- WebRTC P2P Mesh(최대 6인) 시그널링 — Redis Pub/Sub/STOMP 브로드캐스트
- 방장 강퇴 — 임시(10분 재입장 불가) / 영구 (FR-ROOM-07)
- 발화자 감지 (Web Audio `AnalyserNode`), 낙관적 UI + 가상화 채팅 리스트

## 실행
```bash
# 프론트엔드 (개발 서버)
cd frontend && npm install && npm run dev

# 백엔드
cd backend && mvn spring-boot:run   # Redis 7 (localhost:6379), MariaDB 11 (localhost:3306) 필요 (후자는 영구 방 구현 시)
```
