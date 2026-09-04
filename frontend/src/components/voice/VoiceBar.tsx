import React, { useEffect, useRef, useState } from 'react'
import { useVoiceStore, getUid, cleanDeviceLabel } from '../../store/voiceStore'
import { VuMeter } from './VuMeter'
import { AudioSettingsModal } from './AudioSettingsModal'

/** dB 판독 — subscribe + ref DOM 패턴 (신규 rAF 없음) */
const VuDb: React.FC = () => {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let previous = '--'
    const update = (level: number): void => {
      const normalized = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0
      const db = normalized <= 0.001 ? '-60' : `${(20 * Math.log10(normalized)).toFixed(0)}`
      if (db === previous) return
      previous = db
      if (ref.current) ref.current.textContent = `${db} dB`
    }
    update(useVoiceStore.getState().micVolumeLevel)
    return useVoiceStore.subscribe((state) => update(state.micVolumeLevel))
  }, [])

  return <span className="vu-db" ref={ref}>-60 dB</span>
}

export const VoiceBar: React.FC = () => {
  const isInVoice = useVoiceStore((state) => state.isInVoice)
  const isMuted = useVoiceStore((state) => state.isMuted)
  const isDeafened = useVoiceStore((state) => state.isDeafened)
  const inputDevices = useVoiceStore((state) => state.inputDevices)
  const outputDevices = useVoiceStore((state) => state.outputDevices)
  const selectedAudioDeviceId = useVoiceStore((state) => state.selectedAudioDeviceId)
  const selectedSpeakerDeviceId = useVoiceStore((state) => state.selectedSpeakerDeviceId)
  const canSelectOutput = useVoiceStore((state) => state.canSelectOutput)
  const isOutputChanging = useVoiceStore((state) => state.isOutputChanging)
  const outputRouteState = useVoiceStore((state) => state.outputRouteState)
  const outputError = useVoiceStore((state) => state.outputError)
  const error = useVoiceStore((state) => state.error)
  const isAudioAutoplayBlocked = useVoiceStore((state) => state.isAudioAutoplayBlocked)

  const toggleMute = useVoiceStore((state) => state.toggleMute)
  const toggleDeafen = useVoiceStore((state) => state.toggleDeafen)
  const setDevice = useVoiceStore((state) => state.setDevice)
  const setOutputDevice = useVoiceStore((state) => state.setOutputDevice)
  const unlockAudio = useVoiceStore((state) => state.unlockAudio)

  const [showSettings, setShowSettings] = useState(false)
  const me = getUid()
  const isMeTalking = useVoiceStore((state) => !!state.speakingUsers[me])

  return (
    <>
      <footer className="room-voicebar">
        {isAudioAutoplayBlocked && (
          <button
            onClick={() => void unlockAudio()}
            className="voicebar-action-btn"
            style={{ marginBottom: 8, color: 'var(--brand-yellow)' }}
          >
            🔊 오디오 켜기
          </button>
        )}
        <div className="voicebar-inner">
          {/* 마이크/스피커 토글 */}
          <div className="voicebar-controls">
            <button
              className={`voice-btn ${isMuted ? 'muted' : ''}`}
              onClick={toggleMute}
              disabled={!isInVoice}
              title="마이크 켜기/끄기"
            >
              {isMuted ? '🎙️ 마이크 꺼짐' : '🎙️ 마이크 켜짐'}
            </button>
            <button
              className={`voice-btn ${isDeafened ? 'muted' : ''}`}
              onClick={toggleDeafen}
              disabled={!isInVoice}
              title="헤드셋 사운드 켜기/끄기"
            >
              {isDeafened ? '🎧 스피커 꺼짐' : '🎧 스피커 켜짐'}
            </button>
            {isInVoice && isMeTalking && <span className="voice-btn" style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--brand-green)' }}>● 발화 중</span>}
          </div>

          {/* VU 미터 */}
          <div className="voicebar-vu-wrap">
            <div className="vu-meta-row">
              <span className="vu-title">VU 레벨 미터</span>
              <VuDb />
            </div>
            <div className="vu-bars" aria-hidden="true">
              <VuMeter size="sm" />
            </div>
          </div>

          {/* 물리 장치 1:1 드롭다운 */}
          <div className="voicebar-devices">
            <div className="device-select-group">
              <label className="device-label" htmlFor="room-mic-select">🎙️ 마이크</label>
              <select
                id="room-mic-select"
                className="select-device-sm"
                value={selectedAudioDeviceId ?? inputDevices[0]?.deviceId ?? ''}
                aria-label="마이크 입력 장치 선택"
                onChange={(e) => {
                  if (e.target.value) void setDevice(e.target.value)
                }}
              >
                {inputDevices.length === 0 && <option value="">장치 없음</option>}
                {inputDevices.map((d, index) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {cleanDeviceLabel(d.label, `마이크 ${index + 1}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="device-select-group">
              <label className="device-label" htmlFor="room-speaker-select">🔊 스피커 (setSinkId)</label>
              <select
                id="room-speaker-select"
                className="select-device-sm"
                value={selectedSpeakerDeviceId ?? outputDevices[0]?.deviceId ?? ''}
                aria-label="스피커 출력 장치 선택"
                aria-busy={isOutputChanging}
                disabled={!canSelectOutput || isOutputChanging}
                onChange={(e) => void setOutputDevice(e.target.value)}
              >
                {outputDevices.length === 0 && <option value="">장치 없음</option>}
                {outputDevices.map((d, index) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {cleanDeviceLabel(d.label, `스피커 ${index + 1}`)}
                  </option>
                ))}
              </select>
            </div>
            <span className="sr-only" role="status" aria-live="polite">
              {isOutputChanging ? '스피커 전환 중' : outputError ?? (outputRouteState === 'applied' ? '스피커 전환 완료' : '')}
            </span>
          </div>

          {/* 오디오 액션 */}
          <div className="voicebar-actions">
            <button
              className={`voicebar-action-btn ${showSettings ? 'active' : ''}`}
              onClick={() => setShowSettings(true)}
              title="오디오 상세 설정"
            >
              ⚙️ 오디오 설정
            </button>
          </div>
        </div>
        {error && isInVoice && (
          <p style={{ fontSize: 11, color: 'var(--brand-primary)', marginTop: 6 }}>{error}</p>
        )}
      </footer>

      <AudioSettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </>
  )
}