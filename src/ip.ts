import type { SubnetNode } from './types'

const ipToInt = (ip: string): number => {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => p < 0 || p > 255 || Number.isNaN(p))) {
    throw new Error('Invalid IP address')
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

const intToIp = (int: number): string => {
  return [int >>> 24, (int >>> 16) & 255, (int >>> 8) & 255, int & 255].join('.')
}

export const parseCidr = (cidr: string) => {
  const [ip, prefixStr] = cidr.split('/')
  const prefix = Number(prefixStr)
  if (!ip || Number.isNaN(prefix) || prefix < 0 || prefix > 32) {
    throw new Error('Invalid CIDR')
  }
  const base = ipToInt(ip)
  const mask = prefix === 0 ? 0 : (~((1 << (32 - prefix)) - 1)) >>> 0
  const network = base & mask
  const size = 2 ** (32 - prefix)
  return { network, prefix, size }
}

export const splitSubnet = (cidr: string, targetPrefix: number) => {
  const { network, prefix, size } = parseCidr(cidr)
  if (targetPrefix <= prefix || targetPrefix > 32) {
    throw new Error('Target prefix must be larger than current prefix')
  }
  const newSize = 2 ** (32 - targetPrefix)
  const count = size / newSize
  const subnets = [] as { cidr: string; start: number; end: number; size: number }[]
  for (let i = 0; i < count; i++) {
    const start = network + i * newSize
    const end = start + newSize - 1
    subnets.push({ cidr: `${intToIp(start)}/${targetPrefix}`, start, end, size: newSize })
  }
  return subnets
}

export const toSubnetNode = (cidr: string): SubnetNode => {
  const { network, prefix, size } = parseCidr(cidr)
  return {
    id: cidr,
    cidr,
    prefix,
    start: network,
    end: network + size - 1,
    size,
  }
}

export const makeChildren = (node: SubnetNode): SubnetNode[] => {
  if (node.prefix >= 32) return []
  const targetPrefix = node.prefix + 1
  return splitSubnet(node.cidr, targetPrefix).map((s) => ({
    id: s.cidr,
    cidr: s.cidr,
    prefix: targetPrefix,
    start: s.start,
    end: s.end,
    size: s.size,
  }))
}

export const canCombine = (a: SubnetNode, b: SubnetNode) => {
  if (a.prefix !== b.prefix) return false
  const size = a.size
  const lower = Math.min(a.start, b.start)
  const higher = Math.max(a.start, b.start)
  if (higher - lower !== size) return false
  const parentStart = lower - (lower % (size * 2))
  return parentStart === lower
}

export const combinePair = (a: SubnetNode, b: SubnetNode): SubnetNode => {
  if (!canCombine(a, b)) throw new Error('Subnets are not adjacent siblings')
  const parentPrefix = a.prefix - 1
  const start = Math.min(a.start, b.start)
  const cidr = `${intToIp(start)}/${parentPrefix}`
  return toSubnetNode(cidr)
}

export const getRange = (start: number, end: number) => {
  return { first: intToIp(start), last: intToIp(end) }
}

export const getHostBits = (prefix: number) => {
  return 32 - prefix
}

export const getSubnetMask = (prefix: number): string => {
  if (prefix === 0) return '0.0.0.0'
  const mask = (~((1 << (32 - prefix)) - 1)) >>> 0
  return [mask >>> 24, (mask >>> 16) & 255, (mask >>> 8) & 255, mask & 255].join('.')
}

export const getUsableHosts = (size: number): number => {
  // For /31 and /32, special case - no usable hosts in traditional sense
  if (size <= 2) return size === 2 ? 2 : 1 // /31 is point-to-point, /32 is single host
  return size - 2 // subtract network and broadcast addresses
}

export const getNetworkAddress = (start: number): string => {
  return [start >>> 24, (start >>> 16) & 255, (start >>> 8) & 255, start & 255].join('.')
}

export const getBroadcastAddress = (end: number): string => {
  return [end >>> 24, (end >>> 16) & 255, (end >>> 8) & 255, end & 255].join('.')
}
