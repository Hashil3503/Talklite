const STORAGE_KEY = 'talklite_uid';

/**
 * 로컬 스토리지에서 익명 유저 고유 식별자(UUID)를 반환합니다.
 * 존재하지 않을 경우 새로 발급하여 저장합니다.
 */
export function getOrCreateAnonymousId(): string {
  let uid = localStorage.getItem(STORAGE_KEY);
  if (!uid) {
    uid = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, uid);
  }
  return uid;
}

/**
 * 현재 발급된 익명 유저 UUID를 초기화하고 새로 발급합니다 (테스트/리셋용).
 */
export function resetAnonymousId(): string {
  const uid = crypto.randomUUID();
  localStorage.setItem(STORAGE_KEY, uid);
  return uid;
}
