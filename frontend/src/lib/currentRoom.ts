// 참여 중인 방 ID를 탭 저장소에 둔다: 새로고침에는 유지되고 탭을 닫으면 사라진다(T-H4 유예 퇴장과 짝)
const KEY = 'talklite_current_room'

/** 주소의 ?room= 이 우선, 없으면 탭 저장소에 남은 참여 방 */
export function getInitialRoomId(search: string): string | null {
  const fromUrl = new URLSearchParams(search).get('room')
  if (fromUrl) return fromUrl
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function saveCurrentRoomId(roomId: string | null): void {
  try {
    if (roomId) sessionStorage.setItem(KEY, roomId)
    else sessionStorage.removeItem(KEY)
  } catch {
    // 저장소를 못 쓰면 주소의 ?room= 만으로 동작
  }
}
