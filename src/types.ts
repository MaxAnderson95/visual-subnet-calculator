export type SubnetNode = {
  id: string
  cidr: string
  prefix: number
  size: number
  start: number
  end: number
  children?: SubnetNode[]
  isExiting?: boolean
  label?: string
  color?: string
}

export const PRESET_COLORS = [
  '#6cf1d6', // teal (default)
  '#7ea6ff', // blue
  '#c38bff', // purple
  '#ff9ec7', // pink
  '#ffb86c', // orange
  '#50fa7b', // green
  '#ff6b6b', // red
  '#f1fa8c', // yellow
] as const

export type PresetColor = typeof PRESET_COLORS[number]
