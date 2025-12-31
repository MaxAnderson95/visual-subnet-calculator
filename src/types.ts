export type SubnetNode = {
  id: string
  cidr: string
  prefix: number
  size: number
  start: number
  end: number
  children?: SubnetNode[]
  isExiting?: boolean
}
