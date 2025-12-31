import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState, useCallback, useRef } from 'react'
import { canCombine, combinePair, makeChildren, getRange, toSubnetNode, getSubnetMask, getUsableHosts, getNetworkAddress, getBroadcastAddress } from './ip'
import type { SubnetNode } from './types'
import { PRESET_COLORS } from './types'

const colors = ['#6cf1d6', '#7ea6ff', '#c38bff', '#ff9ec7']

// Calculate the max depth of a subtree (how many levels deep it goes)
const getMaxDepth = (node: SubnetNode): number => {
  if (!node.children || node.children.length === 0) return 0
  return 1 + Math.max(...node.children.map(getMaxDepth))
}

const STORAGE_KEY = 'subnet-tree-state'

// Copy to clipboard helper
const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

// Toast notification component
const Toast = ({ message, onClose }: { message: string; onClose: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 2000)
    return () => clearTimeout(timer)
  }, [onClose])

  return (
    <motion.div
      className="toast"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      {message}
    </motion.div>
  )
}

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
  const [editingLabel, setEditingLabel] = useState<string | null>(null)
  const [labelInput, setLabelInput] = useState('')
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [showColorPicker, setShowColorPicker] = useState<string | null>(null)
  const labelInputRef = useRef<HTMLInputElement>(null)

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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedNode(null)
        setEditingLabel(null)
        setShowColorPicker(null)
      }
      // 's' to split selected node
      if (e.key === 's' && selectedNode && !editingLabel && selectedNode.prefix < 31) {
        e.preventDefault()
        split(selectedNode.id)
      }
      // 'c' to combine selected node
      if (e.key === 'c' && selectedNode && !editingLabel && selectedNode.children && selectedNode.children.length > 0) {
        e.preventDefault()
        combine(selectedNode.id)
      }
      // 'l' to edit label
      if (e.key === 'l' && selectedNode && !editingLabel) {
        e.preventDefault()
        setEditingLabel(selectedNode.id)
        setLabelInput(selectedNode.label || '')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedNode, editingLabel])

  // Focus label input when editing
  useEffect(() => {
    if (editingLabel && labelInputRef.current) {
      labelInputRef.current.focus()
    }
  }, [editingLabel])

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

  const updateNodeLabel = useCallback(
    (nodeId: string, label: string) => {
      if (!root) return
      const clone = structuredClone(root) as SubnetNode
      const stack = [clone]
      while (stack.length) {
        const current = stack.pop()!
        if (current.id === nodeId) {
          current.label = label || undefined
          break
        }
        current.children?.forEach((c) => stack.push(c))
      }
      setRoot(clone)
      // Update selectedNode if it's the one being updated
      if (selectedNode?.id === nodeId) {
        setSelectedNode({ ...selectedNode, label: label || undefined })
      }
    },
    [root, selectedNode],
  )

  const updateNodeColor = useCallback(
    (nodeId: string, color: string | undefined) => {
      if (!root) return
      const clone = structuredClone(root) as SubnetNode
      const stack = [clone]
      while (stack.length) {
        const current = stack.pop()!
        if (current.id === nodeId) {
          current.color = color
          break
        }
        current.children?.forEach((c) => stack.push(c))
      }
      setRoot(clone)
      // Update selectedNode if it's the one being updated
      if (selectedNode?.id === nodeId) {
        setSelectedNode({ ...selectedNode, color })
      }
    },
    [root, selectedNode],
  )

  const handleCopy = async (text: string, label: string) => {
    const success = await copyToClipboard(text)
    setToastMessage(success ? `Copied ${label}!` : 'Failed to copy')
  }

  const renderNode = (node: SubnetNode, level: number, index: number = 0, siblingMaxDepth: number = 0, parentIsStacked: boolean = false) => {
    const hasChildren = node.children && node.children.length > 0
    const defaultColor = colors[level % colors.length]
    const nodeColor = node.color || defaultColor
    const isExiting = node.isExiting === true
    const isSelected = selectedNode?.id === node.id
    // After level 3, alternate between horizontal and vertical layouts
    const shouldStackChildren = level >= 3 && (level - 3) % 2 === 0
    
    const maxDepthBelow = getMaxDepth(node)
    const myDeepest = level + maxDepthBelow
    
    // Calculate max depth for children to pass to their siblings
    const childDepths = node.children?.map(c => level + 1 + getMaxDepth(c)) || []
    const maxChildDepth = Math.max(0, ...childDepths)
    
    // Progressive ratio adjustment for deep nesting
    let flexGrow = 5
    
    if (level > 0 && siblingMaxDepth >= 4) {
      const depthBeyondThreshold = siblingMaxDepth - 4
      const depthDifference = myDeepest - siblingMaxDepth
      
      if (depthDifference < 0) {
        flexGrow = Math.max(2, 4 - depthBeyondThreshold)
      } else if (depthDifference === 0) {
        flexGrow = Math.min(8, 6 + depthBeyondThreshold)
      }
    }
    
    const classes = ['box']
    if (shouldStackChildren) classes.push('box-stacked')
    if (isSelected) classes.push('box-selected')
    
    const flexStyle = parentIsStacked ? '0 0 auto' : `${flexGrow} 1 0`
    
    return (
      <motion.div
        key={node.id}
        className={classes.join(' ')}
        initial={level > 0 ? { opacity: 0 } : false}
        animate={isExiting ? { opacity: 0 } : { opacity: 1 }}
        transition={{ duration: 0.25, ease: 'easeInOut' }}
        style={{ 
          borderLeftColor: level > 0 ? nodeColor : 'transparent',
          borderLeftWidth: level > 0 ? '3px' : '0',
          borderLeftStyle: 'solid',
          flex: flexStyle,
          boxShadow: isSelected ? `0 0 0 2px ${nodeColor}, 0 10px 30px rgba(0, 0, 0, 0.25)` : undefined,
        }}
        onClick={(e) => {
          e.stopPropagation()
          setSelectedNode(node)
        }}
      >
        <div className="box-header">
          <div className="box-title-row">
            <div className="box-title">{node.cidr}</div>
            {node.label && <div className="box-label" style={{ color: nodeColor }}>{node.label}</div>}
          </div>
          <div className="button-row" style={{ marginTop: 4 }}>
            {!hasChildren && node.prefix < 31 && (
              <button className="btn-secondary" onClick={(e) => { e.stopPropagation(); split(node.id) }} title="Split (S)">
                Split
              </button>
            )}
            {hasChildren && !isExiting && (
              <button className="btn-danger" onClick={(e) => { e.stopPropagation(); combine(node.id) }} title="Combine (C)">
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
      
      {/* Toast notifications */}
      <AnimatePresence>
        {toastMessage && (
          <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
        )}
      </AnimatePresence>

      {/* Subnet details modal */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              setSelectedNode(null)
              setEditingLabel(null)
              setShowColorPicker(null)
            }}
          >
            <motion.div
              className="modal"
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <div className="modal-title-section">
                  <h2>{selectedNode.cidr}</h2>
                  {editingLabel === selectedNode.id ? (
                    <form
                      className="label-edit-form"
                      onSubmit={(e) => {
                        e.preventDefault()
                        updateNodeLabel(selectedNode.id, labelInput)
                        setEditingLabel(null)
                      }}
                    >
                      <input
                        ref={labelInputRef}
                        type="text"
                        className="label-input"
                        value={labelInput}
                        onChange={(e) => setLabelInput(e.target.value)}
                        placeholder="Enter label..."
                        onBlur={() => {
                          updateNodeLabel(selectedNode.id, labelInput)
                          setEditingLabel(null)
                        }}
                      />
                    </form>
                  ) : (
                    <button
                      className="btn-label"
                      onClick={() => {
                        setEditingLabel(selectedNode.id)
                        setLabelInput(selectedNode.label || '')
                      }}
                      style={{ color: selectedNode.color || '#6cf1d6' }}
                    >
                      {selectedNode.label || '+ Add label'}
                    </button>
                  )}
                </div>
                <button className="modal-close" onClick={() => {
                  setSelectedNode(null)
                  setEditingLabel(null)
                  setShowColorPicker(null)
                }}>
                  &times;
                </button>
              </div>
              
              {/* Color picker */}
              <div className="color-picker-section">
                <span className="modal-label">Color</span>
                <div className="color-picker-row">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      className={`color-swatch ${selectedNode.color === color ? 'color-swatch-selected' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => updateNodeColor(selectedNode.id, color)}
                      title={color}
                    />
                  ))}
                  <button
                    className={`color-swatch color-swatch-none ${!selectedNode.color ? 'color-swatch-selected' : ''}`}
                    onClick={() => updateNodeColor(selectedNode.id, undefined)}
                    title="Default"
                  >
                    <span>&times;</span>
                  </button>
                </div>
              </div>

              <div className="modal-body">
                <div className="modal-row clickable" onClick={() => handleCopy(selectedNode.cidr, 'CIDR')}>
                  <span className="modal-label">CIDR</span>
                  <span className="modal-value">{selectedNode.cidr} <span className="copy-hint">click to copy</span></span>
                </div>
                <div className="modal-row clickable" onClick={() => handleCopy(getSubnetMask(selectedNode.prefix), 'subnet mask')}>
                  <span className="modal-label">Subnet Mask</span>
                  <span className="modal-value">{getSubnetMask(selectedNode.prefix)} <span className="copy-hint">click to copy</span></span>
                </div>
                <div className="modal-row">
                  <span className="modal-label">Total Addresses</span>
                  <span className="modal-value">{selectedNode.size.toLocaleString()}</span>
                </div>
                <div className="modal-row">
                  <span className="modal-label">Usable Hosts</span>
                  <span className="modal-value">{getUsableHosts(selectedNode.size).toLocaleString()}</span>
                </div>
                <div className="modal-row clickable" onClick={() => handleCopy(getRange(selectedNode.start, selectedNode.end).first, 'first IP')}>
                  <span className="modal-label">Network Address</span>
                  <span className="modal-value">{getRange(selectedNode.start, selectedNode.end).first} <span className="copy-hint">click to copy</span></span>
                </div>
                <div className="modal-row clickable" onClick={() => handleCopy(getRange(selectedNode.start, selectedNode.end).last, 'last IP')}>
                  <span className="modal-label">Broadcast Address</span>
                  <span className="modal-value">{getRange(selectedNode.start, selectedNode.end).last} <span className="copy-hint">click to copy</span></span>
                </div>
                <div className="modal-row clickable" onClick={() => handleCopy(`${getRange(selectedNode.start, selectedNode.end).first} - ${getRange(selectedNode.start, selectedNode.end).last}`, 'IP range')}>
                  <span className="modal-label">IP Range</span>
                  <span className="modal-value">{getRange(selectedNode.start, selectedNode.end).first} - {getRange(selectedNode.start, selectedNode.end).last} <span className="copy-hint">click to copy</span></span>
                </div>
              </div>

              <div className="modal-actions">
                {!selectedNode.children && selectedNode.prefix < 31 && (
                  <button className="btn-primary" onClick={() => { split(selectedNode.id); setSelectedNode(null) }}>
                    Split Subnet
                  </button>
                )}
                {selectedNode.children && selectedNode.children.length > 0 && (
                  <button className="btn-danger" onClick={() => { combine(selectedNode.id); setSelectedNode(null) }}>
                    Combine Children
                  </button>
                )}
              </div>

              <div className="modal-shortcuts">
                <span className="shortcut-hint">Keyboard: <kbd>S</kbd> Split <kbd>C</kbd> Combine <kbd>L</kbd> Label <kbd>Esc</kbd> Close</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

export default SubnetTree
