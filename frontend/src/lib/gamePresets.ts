export interface GamePreset {
  label: string
  game: string
}

export const GAME_PRESETS: GamePreset[] = [
  { label: '전체', game: '' },
  { label: '리그 오브 레전드', game: '리그 오브 레전드' },
  { label: '발로란트', game: '발로란트' },
  { label: '배틀그라운드', game: '배틀그라운드' },
  { label: '오버워치 2', game: '오버워치 2' },
]

export const GAME_SUGGESTIONS: string[] = GAME_PRESETS.filter((p) => p.game).map((p) => p.game)
