import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState, useCallback } from 'react'
import { canCombine, combinePair, makeChildren, getRange, toSubnetNode } from './ip'
import type { SubnetNode } from './types'

const colors = ['#6cf1d6', '#7ea6ff', '#c38bff', '#ff9ec7']

// Calculate the max depth of a subtree (how many levels deep it goes)
const getMaxDepth = (node: SubnetNode): number => {
  if (!node.children || node.children.length === 0) return 0
  return 1 + Math.max(...node.children.map(getMaxDepth))
}

const STORAGE_KEY = 'subnet-tree-state'

const SubnetTree = ({ cidr, resetKey }: { cidr: string; resetKey: number }) => {
  const [root, setRoot] = useState<SubnetNode | null>(() => {
    try {
      // Try to restore from localStorage
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        // Only restore if the saved CIDR matches
        if (parsed && parsed.cidr === cidr) {
          return parsed
        }
      }
      return toSubnetNode(cidr)
    } catch {
      return null
    }
  })
  const [selectedNode, setSelectedNode] = useState<SubnetNode | null>(null)

  // Persist tree state to localStorage whenever it changes
  useEffect(() => {
    if (root) {
      // Remove isExiting flags before saving
      const cleanNode = (node: SubnetNode): SubnetNode => {
        const { isExiting, ...rest } = node as SubnetNode & { isExiting?: boolean }
        return {
          ...rest,
          children: node.children?.map(cleanNode)
        }
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanNode(root)))
    }
  }, [root])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedNode(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    try {
      // Check if we have a saved state for this CIDR
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed && parsed.cidr === cidr) {
          setRoot(parsed)
          return
        }
      }
      setRoot(toSubnetNode(cidr))
    } catch (err) {
      setRoot(null)
    }
  }, [cidr])

  useEffect(() => {
    if (resetKey > 0) {
      // Mark all children as exiting first
      setRoot(prev => {
        if (!prev || !prev.children) return prev
        const markAllExiting = (node: SubnetNode): SubnetNode => ({
          ...node,
          isExiting: true,
          children: node.children?.map(c => markAllExiting(c))
        })
        return {
          ...prev,
          children: prev.children.map(c => markAllExiting(c))
        }
      })
      
      // Then reset after animation
      setTimeout(() => {
        try {
          setRoot(toSubnetNode(cidr))
        } catch (err) {
          setRoot(null)
        }
      }, 250)
    }
  }, [resetKey, cidr])

  const split = useCallback(
    (nodeId: string) => {
      if (!root) return
      const clone = structuredClone(root) as SubnetNode
      const stack = [clone]
      while (stack.length) {
        const current = stack.pop()!
        if (current.id === nodeId) {
          current.children = makeChildren(current)
          break
        }
        current.children?.forEach((c) => stack.push(c))
      }
      setRoot(clone)
    },
    [root],
  )

  const combine = useCallback(
    (nodeId: string) => {
      if (!root) return
      
      // First mark children as exiting
      const markExiting = (node: SubnetNode): SubnetNode => {
        if (node.id === nodeId && node.children && node.children.length > 0) {
          return {
            ...node,
            children: node.children.map(c => ({ ...c, isExiting: true } as SubnetNode))
          }
        }
        if (!node.children) return node
        return {
          ...node,
          children: node.children.map(c => markExiting(c))
        }
      }
      
      const marked = markExiting(root)
      setRoot(marked)
      
      // Then actually remove after animation
      setTimeout(() => {
        setRoot(prev => {
          if (!prev) return prev
          const clone = structuredClone(prev) as SubnetNode
          const removeChildren = (node: SubnetNode): boolean => {
            if (node.id === nodeId && node.children && node.children.length > 0) {
              node.children = undefined
              return true
            }
            if (!node.children) return false
            return node.children.some(c => removeChildren(c))
          }
          removeChildren(clone)
          return clone
        })
      }, 250)
    },
    [root],
  )

  const renderNode = (node: SubnetNode, level: number, index: number = 0, siblingMaxDepth: number = 0, parentIsStacked: boolean = false) => {
    const hasChildren = node.children && node.children.length > 0
    const color = colors[level % colors.length]
    const isExiting = node.isExiting === true
    // After level 3, alternate between horizontal and vertical layouts
    // Level 0-2: horizontal (default)
    // Level 3: vertical (stacked)
    // Level 4: horizontal
    // Level 5: vertical (stacked)
    // etc.
    const shouldStackChildren = level >= 3 && (level - 3) % 2 === 0
    
    const maxDepthBelow = getMaxDepth(node)
    const myDeepest = level + maxDepthBelow
    
    // Calculate max depth for children to pass to their siblings
    const childDepths = node.children?.map(c => level + 1 + getMaxDepth(c)) || []
    const maxChildDepth = Math.max(0, ...childDepths)
    
    // After split 4+ (4 or more levels from root), progressively adjust from 50/50
    // Progressive ratio: 50/50 -> 60/40 -> 70/30 as depth difference increases
    let flexGrow = 5 // Base flex represents 50%
    
    // When any sibling reaches deep nesting (4+ levels from root), adjust sizing progressively
    if (level > 0 && siblingMaxDepth >= 4) {
      // How many levels beyond the threshold (4) does the deepest sibling go?
      const depthBeyondThreshold = siblingMaxDepth - 4
      // Compare this node's depth to its sibling's max depth
      const depthDifference = myDeepest - siblingMaxDepth
      
      if (depthDifference < 0) {
        // This node is shallower - reduce its flex progressively
        // Start at 4 (representing 40%), decrease by 1 for each additional level (minimum 2)
        flexGrow = Math.max(2, 4 - depthBeyondThreshold)
      } else if (depthDifference === 0) {
        // This is the deepest node - increase its flex progressively  
        // Start at 6 (representing 60%), increase by 1 for each additional level (maximum 8)
        flexGrow = Math.min(8, 6 + depthBeyondThreshold)
      }
    }
    
    const classes = ['box']
    if (shouldStackChildren) classes.push('box-stacked')
    
    // Determine flex based on whether parent is stacked (column) or horizontal (row)
    // In stacked parent: use auto sizing
    // In horizontal parent: use flex grow for proportional sizing
    const flexStyle = parentIsStacked ? '0 0 auto' : `${flexGrow} 1 0`
    
    return (
      <motion.div
        key={node.id}
        className={classes.join(' ')}
        initial={level > 0 ? { opacity: 0 } : false}
        animate={isExiting ? { opacity: 0 } : { opacity: 1 }}
        transition={{ duration: 0.25, ease: 'easeInOut' }}
        style={{ 
          borderLeftColor: level > 0 ? color : 'transparent',
          borderLeftWidth: level > 0 ? '3px' : '0',
          borderLeftStyle: 'solid',
          flex: flexStyle,
        }}
        onClick={(e) => {
          e.stopPropagation()
          setSelectedNode(node)
        }}
      >
        <div className="box-header">
          <div className="box-title">{node.cidr}</div>
          <div className="button-row" style={{ marginTop: 4 }}>
            {!hasChildren && node.prefix < 31 && (
              <button className="btn-secondary" onClick={(e) => { e.stopPropagation(); split(node.id) }}>
                Split
              </button>
            )}
            {hasChildren && !isExiting && (
              <button className="btn-danger" onClick={(e) => { e.stopPropagation(); combine(node.id) }}>
                Combine
              </button>
            )}
          </div>
        </div>
        {hasChildren && (
          <div className="box-children">
            {node.children!.map((child, i) => renderNode(child, level + 1, i, maxChildDepth, shouldStackChildren))}
          </div>
        )}
      </motion.div>
    )
  }

  if (!root) {
    return null
  }

  return (
    <>
      <AnimatePresence mode="popLayout">
        <div style={{ width: '100%' }}>{renderNode(root, 0)}</div>
      </AnimatePresence>
      <AnimatePresence>
        {selectedNode && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedNode(null)}
          >
            <motion.div
              className="modal"
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <h2>{selectedNode.cidr}</h2>
                <button className="modal-close" onClick={() => setSelectedNode(null)}>
                  &times;
                </button>
              </div>
              <div className="modal-body">
                <div className="modal-row">
                  <span className="modal-label">Hosts</span>
                  <span className="modal-value">{selectedNode.size.toLocaleString()}</span>
                </div>
                <div className="modal-row">
                  <span className="modal-label">First IP</span>
                  <span className="modal-value">{getRange(selectedNode.start, selectedNode.end).first}</span>
                </div>
                <div className="modal-row">
                  <span className="modal-label">Last IP</span>
                  <span className="modal-value">{getRange(selectedNode.start, selectedNode.end).last}</span>
                </div>
                <div className="modal-row">
                  <span className="modal-label">Netmask</span>
                  <span className="modal-value">/{selectedNode.prefix}</span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

export default SubnetTree
