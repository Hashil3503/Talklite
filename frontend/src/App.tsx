import { useEffect, useState } from 'react'
import { getOrCreateAnonymousId, resetAnonymousId } from './lib/uid'

function App() {
  const [uid, setUid] = useState<string>('')
  const [healthStatus, setHealthStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [healthData, setHealthData] = useState<any>(null)

  useEffect(() => {
    // 1. 익명 UUID 발급 및 조회
    setUid(getOrCreateAnonymousId())

    // 2. 백엔드 /api/health 호출
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) throw new Error('Health check failed')
        return res.json()
      })
      .then((data) => {
        setHealthData(data)
        setHealthStatus(data.status === 'ok' ? 'ok' : 'error')
      })
      .catch(() => {
        setHealthStatus('error')
      })
  }, [])

  const handleResetUid = () => {
    const newUid = resetAnonymousId()
    setUid(newUid)
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full bg-neutral-900 border border-neutral-800 rounded-2xl p-8 shadow-2xl space-y-6 text-center">
        <div>
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-400 mb-3 border border-emerald-500/20 text-2xl">
            🎙️
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-emerald-400">Talklite</h1>
          <p className="text-sm text-neutral-400 mt-1">온디맨드 게이머 파티 매칭 & 오픈 보이스 플랫폼</p>
        </div>

        <div className="bg-neutral-950/60 rounded-xl p-4 border border-neutral-800 text-left space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-400 font-medium">백엔드 상태 (/api/health)</span>
            {healthStatus === 'loading' && <span className="text-amber-400 font-medium animate-pulse">연결 확인 중...</span>}
            {healthStatus === 'ok' && (
              <span className="text-emerald-400 font-semibold flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400"></span> 200 OK
              </span>
            )}
            {healthStatus === 'error' && (
              <span className="text-rose-400 font-semibold flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-rose-400"></span> 연결 실패
              </span>
            )}
          </div>

          {healthData && (
            <div className="text-xs font-mono bg-neutral-900/80 p-2 rounded text-neutral-400 border border-neutral-800">
              응답: {JSON.stringify(healthData)}
            </div>
          )}

          <div className="space-y-1.5 pt-2 border-t border-neutral-800/80">
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-400 font-medium">내 익명 고유 ID</span>
              <button
                onClick={handleResetUid}
                className="text-xs text-emerald-400 hover:text-emerald-300 underline cursor-pointer transition-colors"
              >
                재발급
              </button>
            </div>
            <p className="font-mono text-xs text-neutral-200 bg-neutral-900 p-2.5 rounded border border-neutral-800 break-all select-all">
              {uid || '발급 중...'}
            </p>
          </div>
        </div>

        <div className="text-xs text-neutral-500 space-y-1">
          <p className="font-medium text-neutral-400">Phase 0: 환경 셋업 & 프록시 통신 검증 완료</p>
          <p>Spring Boot (8080) ↔ Vite Proxy ↔ React (5173)</p>
        </div>
      </div>
    </div>
  )
}

export default App
