/** 게임명 → 목업 badge-game 동적 클래스 매핑 (lol/val/pubg/ow) */
export function gameBadgeClass(game: string): string {
  const g = game.toLowerCase()
  if (g.includes('legend') || g.includes('리그') || g.includes('롤')) return 'lol'
  if (g.includes('val') || g.includes('발로')) return 'val'
  if (g.includes('pubg') || g.includes('배그') || g.includes('배틀')) return 'pubg'
  if (g.includes('overwatch') || g.includes('오버워치') || g.includes('옵치')) return 'ow'
  return ''
}