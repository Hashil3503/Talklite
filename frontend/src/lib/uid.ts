const UID_KEY = 'talklite_uid'
const SECRET_KEY = 'talklite_uid_secret'

/**
 * 서버가 발급한 UID를 반환합니다. 아직 발급 전(앱 부팅 초기)이면 빈 문자열입니다.
 */
export function getStoredUid(): string {
  try {
    return localStorage.getItem(UID_KEY) || ''
  } catch {
    return ''
  }
}

/**
 * 서버가 발급한 UID와 비밀값을 저장합니다.
 */
export function saveSessionCredentials(uid: string, secret?: string | null): void {
  if (uid) localStorage.setItem(UID_KEY, uid)
  if (secret) localStorage.setItem(SECRET_KEY, secret)
}

/**
 * 저장된 비밀값을 반환합니다 (없으면 빈 문자열).
 */
export function getStoredSecret(): string {
  try {
    return localStorage.getItem(SECRET_KEY) || ''
  } catch {
    return ''
  }
}
