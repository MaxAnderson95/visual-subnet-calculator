import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState, useCallback, useRef } from 'react'
import { makeChildren, getRange, toSubnetNode, getSubnetMask, getUsableHosts } from './ip'
import type { SubnetNode } from './types'
import { PRESET_COLORS } from './types'
import { useHistory } from './useHistory'

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

// Check if an IP is within a subnet range
const ipInRange = (ip: string, start: number, end: number): boolean => {
  try {
    const parts = ip.split('.').map(Number)
    if (parts.length !== 4 || parts.some(p => p < 0 || p > 255 || Number.isNaN(p))) {
      return false
    }
    const ipInt = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
    return ipInt >= start && ipInt <= end
  } catch {
    return false
  }
}

// Flatten tree for search results
const flattenTree = (node: SubnetNode, path: string[] = []): { node: SubnetNode; path: string[] }[] => {
  const result: { node: SubnetNode; path: string[] }[] = [{ node, path }]
  if (node.children) {
    node.children.forEach((child) => {
      result.push(...flattenTree(child, [...path, node.id]))
    })
  }
  return result
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

// IP Address Bar component - does NOT zoom, always shows full width
const IPAddressBar = ({ root }: { root: SubnetNode }) => {
  const getAllLeafNodes = (node: SubnetNode): SubnetNode[] => {
    if (!node.children || node.children.length === 0 || node.collapsed) {
      return [node]
    }
    return node.children.flatMap(getAllLeafNodes)
  }

  const leaves = getAllLeafNodes(root)
  const totalSize = root.size

  return (
    <div className="ip-bar-container">
      <div className="ip-bar-label">IP Space</div>
      <div className="ip-bar">
        {leaves.map((leaf) => {
          const widthPercent = (leaf.size / totalSize) * 100
          const nodeColor = leaf.color || colors[0]
          return (
            <div
              key={leaf.id}
              className="ip-bar-segment"
              style={{
                width: `${widthPercent}%`,
                backgroundColor: nodeColor,
                opacity: 0.8,
              }}
              title={`${leaf.cidr}${leaf.label ? ` - ${leaf.label}` : ''}`}
            >
              {widthPercent > 5 && (
                <span className="ip-bar-segment-label">
                  {leaf.label || leaf.cidr.split('/')[1]}
                </span>
              )}
            </div>
          )
        })}
      </div>
      <div className="ip-bar-range">
        <span>{getRange(root.start, root.end).first}</span>
        <span>{getRange(root.start, root.end).last}</span>
      </div>
    </div>
  )
}

// Minimap component
const Minimap = ({ 
  root, 
  containerRef,
  onNavigate 
}: { 
  root: SubnetNode
  containerRef: React.RefObject<HTMLDivElement | null>
  onNavigate: (scrollLeft: number, scrollTop: number) => void
}) => {
  const minimapRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ left: 0, top: 0, width: 100, height: 100 })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateViewport = () => {
      const { scrollLeft, scrollTop, scrollWidth, scrollHeight, clientWidth, clientHeight } = container
      setViewport({
        left: (scrollLeft / scrollWidth) * 100,
        top: (scrollTop / scrollHeight) * 100,
        width: (clientWidth / scrollWidth) * 100,
        height: (clientHeight / scrollHeight) * 100,
      })
    }

    updateViewport()
    container.addEventListener('scroll', updateViewport)
    const resizeObserver = new ResizeObserver(updateViewport)
    resizeObserver.observe(container)

    return () => {
      container.removeEventListener('scroll', updateViewport)
      resizeObserver.disconnect()
    }
  }, [containerRef])

  const handleMinimapClick = (e: React.MouseEvent) => {
    const rect = minimapRef.current?.getBoundingClientRect()
    const container = containerRef.current
    if (!rect || !container) return

    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height

    const scrollLeft = x * container.scrollWidth - container.clientWidth / 2
    const scrollTop = y * container.scrollHeight - container.clientHeight / 2

    onNavigate(Math.max(0, scrollLeft), Math.max(0, scrollTop))
  }

  const countNodes = (node: SubnetNode): number => {
    if (!node.children || node.collapsed) return 1
    return 1 + node.children.reduce((acc, child) => acc + countNodes(child), 0)
  }

  const totalNodes = countNodes(root)
  const depth = getMaxDepth(root)

  // Only show minimap for complex trees
  if (totalNodes < 10 && depth < 3) return null

  return (
    <div 
      className="minimap" 
      ref={minimapRef}
      onClick={handleMinimapClick}
    >
      <div className="minimap-content">
        <MinimapNode node={root} depth={0} />
      </div>
      <div 
        className="minimap-viewport"
        style={{
          left: `${viewport.left}%`,
          top: `${viewport.top}%`,
          width: `${Math.min(100, viewport.width)}%`,
          height: `${Math.min(100, viewport.height)}%`,
        }}
      />
    </div>
  )
}

const MinimapNode = ({ node, depth }: { node: SubnetNode; depth: number }) => {
  const hasChildren = node.children && node.children.length > 0 && !node.collapsed
  const nodeColor = node.color || colors[depth % colors.length]

  return (
    <div className="minimap-node" style={{ borderLeftColor: nodeColor }}>
      {hasChildren && (
        <div className="minimap-children">
          {node.children!.map(child => (
            <MinimapNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

// Draggable box wrapper to avoid motion.div drag conflicts
const DraggableBox = ({ 
  node, 
  level, 
  children, 
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: {
  node: SubnetNode
  level: number
  children: React.ReactNode
  onDragStart: (e: React.DragEvent, node: SubnetNode) => void
  onDragOver: (e: React.DragEvent, nodeId: string) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, node: SubnetNode) => void
  onDragEnd: () => void
}) => {
  if (level === 0) {
    return <>{children}</>
  }

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, node)}
      onDragOver={(e) => onDragOver(e, node.id)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, node)}
      onDragEnd={onDragEnd}
      style={{ display: 'contents' }}
    >
      {children}
    </div>
  )
}

interface SubnetTreeProps {
  cidr: string
  resetKey: number
}

const SubnetTree = ({ cidr, resetKey }: SubnetTreeProps) => {
  const getInitialRoot = useCallback((): SubnetNode | null => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed && parsed.cidr === cidr) {
          return parsed
        }
      }
      return toSubnetNode(cidr)
    } catch {
      return null
    }
  }, [cidr])

  const history = useHistory<SubnetNode | null>(getInitialRoot())
  const root = history.current
  
  const [selectedNode, setSelectedNode] = useState<SubnetNode | null>(null)
  const [editingLabel, setEditingLabel] = useState<string | null>(null)
  const [editingNotes, setEditingNotes] = useState<string | null>(null)
  const [labelInput, setLabelInput] = useState('')
  const [notesInput, setNotesInput] = useState('')
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ node: SubnetNode; path: string[] }[]>([])
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(100)
  const [draggedNode, setDraggedNode] = useState<SubnetNode | null>(null)
  const [dragOverNode, setDragOverNode] = useState<string | null>(null)
  const labelInputRef = useRef<HTMLInputElement>(null)
  const notesInputRef = useRef<HTMLTextAreaElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  // Set root helper that adds to history
  const setRoot = useCallback((newRoot: SubnetNode | null | ((prev: SubnetNode | null) => SubnetNode | null)) => {
    if (typeof newRoot === 'function') {
      const result = newRoot(root)
      if (result) history.set(result)
    } else if (newRoot) {
      history.set(newRoot)
    }
  }, [root, history])

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
      // Undo/Redo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        history.undo()
        setToastMessage('Undo')
        return
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        history.redo()
        setToastMessage('Redo')
        return
      }
      
      // Search focus
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        document.getElementById('subnet-search')?.focus()
        return
      }

      if (e.key === 'Escape') {
        // First blur the active element to trigger save
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur()
        }
        // Small timeout to allow blur handlers to complete
        setTimeout(() => {
          setSelectedNode(null)
          setEditingLabel(null)
          setEditingNotes(null)
        }, 10)
        setSearchQuery('')
        setSearchResults([])
        setHighlightedNodeId(null)
      }
      // 's' to split selected node
      if (e.key === 's' && selectedNode && !editingLabel && !editingNotes && selectedNode.prefix < 31) {
        e.preventDefault()
        split(selectedNode.id)
      }
      // 'c' to combine selected node
      if (e.key === 'c' && selectedNode && !editingLabel && !editingNotes && selectedNode.children && selectedNode.children.length > 0) {
        e.preventDefault()
        combine(selectedNode.id)
      }
      // 'l' to edit label
      if (e.key === 'l' && selectedNode && !editingLabel && !editingNotes) {
        e.preventDefault()
        setEditingLabel(selectedNode.id)
        setLabelInput(selectedNode.label || '')
      }
      // 'n' to edit notes
      if (e.key === 'n' && selectedNode && !editingLabel && !editingNotes) {
        e.preventDefault()
        setEditingNotes(selectedNode.id)
        setNotesInput(selectedNode.notes || '')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedNode, editingLabel, editingNotes, history])

  // Focus label input when editing
  useEffect(() => {
    if (editingLabel && labelInputRef.current) {
      labelInputRef.current.focus()
    }
  }, [editingLabel])

  // Focus notes input when editing
  useEffect(() => {
    if (editingNotes && notesInputRef.current) {
      notesInputRef.current.focus()
    }
  }, [editingNotes])

  // Search functionality
  useEffect(() => {
    if (!searchQuery.trim() || !root) {
      setSearchResults([])
      setHighlightedNodeId(null)
      return
    }

    const query = searchQuery.toLowerCase().trim()
    const allNodes = flattenTree(root)
    
    const matches = allNodes.filter(({ node }) => {
      // Match by CIDR
      if (node.cidr.toLowerCase().includes(query)) return true
      // Match by label
      if (node.label?.toLowerCase().includes(query)) return true
      // Match by notes
      if (node.notes?.toLowerCase().includes(query)) return true
      // Match by IP address (check if IP is in range)
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(query)) {
        return ipInRange(query, node.start, node.end)
      }
      return false
    })

    setSearchResults(matches)
    if (matches.length > 0) {
      setHighlightedNodeId(matches[0].node.id)
    }
  }, [searchQuery, root])

  useEffect(() => {
    try {
      // Check if we have a saved state for this CIDR
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed && parsed.cidr === cidr) {
          history.reset(parsed)
          return
        }
      }
      history.reset(toSubnetNode(cidr))
    } catch {
      history.reset(null)
    }
  }, [cidr])

  useEffect(() => {
    if (resetKey > 0) {
      // Mark all children as exiting first
      if (root?.children) {
        const markAllExiting = (node: SubnetNode): SubnetNode => ({
          ...node,
          isExiting: true,
          children: node.children?.map(c => markAllExiting(c))
        })
        history.set({
          ...root,
          children: root.children.map(c => markAllExiting(c))
        })
      }
      
      // Then reset after animation
      setTimeout(() => {
        try {
          history.reset(toSubnetNode(cidr))
        } catch {
          history.reset(null)
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
    [root, setRoot],
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
      history.set(marked)
      
      // Then actually remove after animation
      setTimeout(() => {
        const clone = structuredClone(marked) as SubnetNode
        const removeChildren = (node: SubnetNode): boolean => {
          if (node.id === nodeId && node.children && node.children.length > 0) {
            node.children = undefined
            return true
          }
          if (!node.children) return false
          return node.children.some(c => removeChildren(c))
        }
        removeChildren(clone)
        history.set(clone)
      }, 250)
    },
    [root, history],
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
    [root, selectedNode, setRoot],
  )

  const updateNodeNotes = useCallback(
    (nodeId: string, notes: string) => {
      if (!root) return
      const clone = structuredClone(root) as SubnetNode
      const stack = [clone]
      while (stack.length) {
        const current = stack.pop()!
        if (current.id === nodeId) {
          current.notes = notes || undefined
          break
        }
        current.children?.forEach((c) => stack.push(c))
      }
      setRoot(clone)
      // Update selectedNode if it's the one being updated
      if (selectedNode?.id === nodeId) {
        setSelectedNode({ ...selectedNode, notes: notes || undefined })
      }
    },
    [root, selectedNode, setRoot],
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
    [root, selectedNode, setRoot],
  )

  const toggleCollapse = useCallback(
    (nodeId: string) => {
      if (!root) return
      const clone = structuredClone(root) as SubnetNode
      const stack = [clone]
      while (stack.length) {
        const current = stack.pop()!
        if (current.id === nodeId) {
          current.collapsed = !current.collapsed
          break
        }
        current.children?.forEach((c) => stack.push(c))
      }
      setRoot(clone)
    },
    [root, setRoot],
  )

  const collapseAll = useCallback(() => {
    if (!root) return
    const setAllCollapsed = (node: SubnetNode, collapsed: boolean): SubnetNode => ({
      ...node,
      collapsed: node.children && node.children.length > 0 ? collapsed : undefined,
      children: node.children?.map(c => setAllCollapsed(c, collapsed))
    })
    setRoot(setAllCollapsed(root, true))
  }, [root, setRoot])

  const expandAll = useCallback(() => {
    if (!root) return
    const setAllExpanded = (node: SubnetNode): SubnetNode => ({
      ...node,
      collapsed: undefined,
      children: node.children?.map(c => setAllExpanded(c))
    })
    setRoot(setAllExpanded(root))
  }, [root, setRoot])

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, node: SubnetNode) => {
    e.stopPropagation()
    setDraggedNode(node)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', node.id)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, nodeId: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (draggedNode && draggedNode.id !== nodeId) {
      setDragOverNode(nodeId)
    }
  }, [draggedNode])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOverNode(null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, targetNode: SubnetNode) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverNode(null)
    
    if (!draggedNode || !root || draggedNode.id === targetNode.id) {
      setDraggedNode(null)
      return
    }

    // Find parent of dragged node and target node
    const findParent = (node: SubnetNode, targetId: string): SubnetNode | null => {
      if (node.children?.some(c => c.id === targetId)) {
        return node
      }
      for (const child of node.children || []) {
        const found = findParent(child, targetId)
        if (found) return found
      }
      return null
    }

    const draggedParent = findParent(root, draggedNode.id)
    const targetParent = findParent(root, targetNode.id)

    // Only allow reordering within same parent (siblings)
    if (!draggedParent || !targetParent || draggedParent.id !== targetParent.id) {
      setDraggedNode(null)
      setToastMessage('Can only reorder siblings')
      return
    }

    // Reorder children
    const clone = structuredClone(root) as SubnetNode
    const stack = [clone]
    while (stack.length) {
      const current = stack.pop()!
      if (current.id === draggedParent.id && current.children) {
        const children = [...current.children]
        const draggedIndex = children.findIndex(c => c.id === draggedNode.id)
        const targetIndex = children.findIndex(c => c.id === targetNode.id)
        
        if (draggedIndex !== -1 && targetIndex !== -1) {
          const [removed] = children.splice(draggedIndex, 1)
          children.splice(targetIndex, 0, removed)
          current.children = children
        }
        break
      }
      current.children?.forEach(c => stack.push(c))
    }

    setRoot(clone)
    setDraggedNode(null)
  }, [draggedNode, root, setRoot])

  const handleDragEnd = useCallback(() => {
    setDraggedNode(null)
    setDragOverNode(null)
  }, [])

  const handleCopy = async (text: string, label: string) => {
    const success = await copyToClipboard(text)
    setToastMessage(success ? `Copied ${label}!` : 'Failed to copy')
  }

  const navigateToResult = (nodeId: string) => {
    setHighlightedNodeId(nodeId)
    // Expand parents to show the node
    if (!root) return
    
    const expandParents = (node: SubnetNode, targetId: string): boolean => {
      if (node.id === targetId) return true
      if (!node.children) return false
      
      for (const child of node.children) {
        if (expandParents(child, targetId)) {
          node.collapsed = false
          return true
        }
      }
      return false
    }
    
    const clone = structuredClone(root) as SubnetNode
    expandParents(clone, nodeId)
    setRoot(clone)
  }

  const renderNode = (node: SubnetNode, level: number, index: number = 0, siblingMaxDepth: number = 0, parentIsStacked: boolean = false) => {
    const hasChildren = node.children && node.children.length > 0
    const isCollapsed = node.collapsed && hasChildren
    const defaultColor = colors[level % colors.length]
    const nodeColor = node.color || defaultColor
    const isExiting = node.isExiting === true
    const isSelected = selectedNode?.id === node.id
    const isHighlighted = highlightedNodeId === node.id
    const isDragOver = dragOverNode === node.id
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
    if (isHighlighted) classes.push('box-highlighted')
    if (isDragOver) classes.push('box-drag-over')
    
    // Root level should fill width, children should size to content
    const flexStyle = level === 0 ? '1 0 100%' : (parentIsStacked ? '0 0 auto' : `${flexGrow} 0 auto`)
    
    return (
      <DraggableBox
        key={node.id}
        node={node}
        level={level}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
      >
        <motion.div
          className={classes.join(' ')}
          initial={level > 0 ? { opacity: 0 } : false}
          animate={isExiting ? { opacity: 0 } : { opacity: 1 }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
          style={{ 
            borderLeftColor: level > 0 ? nodeColor : 'transparent',
            borderLeftWidth: level > 0 ? '3px' : '0',
            borderLeftStyle: 'solid',
            flex: flexStyle,
            boxShadow: isSelected ? `0 0 0 2px ${nodeColor}, 0 10px 30px rgba(0, 0, 0, 0.25)` : 
                       isHighlighted ? `0 0 0 2px #ffb86c, 0 10px 30px rgba(255, 184, 108, 0.3)` : undefined,
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
              {node.notes && <span className="box-notes-indicator" title={node.notes}>📝</span>}
            </div>
            <div className="button-row" style={{ marginTop: 4 }}>
              {hasChildren && (
                <button 
                  className="btn-icon btn-collapse" 
                  onClick={(e) => { e.stopPropagation(); toggleCollapse(node.id) }}
                  title={isCollapsed ? 'Expand' : 'Collapse'}
                >
                  {isCollapsed ? '▶' : '▼'}
                </button>
              )}
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
          {hasChildren && !isCollapsed && (
            <div className="box-children">
              {node.children!.map((child, i) => renderNode(child, level + 1, i, maxChildDepth, shouldStackChildren))}
            </div>
          )}
          {isCollapsed && (
            <div className="box-collapsed-indicator">
              {node.children!.length} subnet{node.children!.length > 1 ? 's' : ''} hidden
            </div>
          )}
        </motion.div>
      </DraggableBox>
    )
  }

  if (!root) {
    return null
  }

  // TypeScript narrowing: root is guaranteed non-null after the check above
  const safeRoot: SubnetNode = root

  return (
    <>
      {/* Toolbar */}
      <div className="tree-toolbar">
        <div className="toolbar-left">
          <div className="search-container">
            <input
              id="subnet-search"
              type="text"
              className="search-input"
              placeholder="Search CIDR, label, or IP..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="search-clear" onClick={() => { setSearchQuery(''); setSearchResults([]); setHighlightedNodeId(null) }}>
                ×
              </button>
            )}
          </div>
          {searchResults.length > 0 && (
            <div className="search-results-count">
              {searchResults.length} result{searchResults.length > 1 ? 's' : ''}
            </div>
          )}
        </div>
        <div className="toolbar-right">
          <button 
            className="btn-icon" 
            onClick={history.undo} 
            disabled={!history.canUndo}
            title="Undo (Ctrl+Z)"
          >
            ↶
          </button>
          <button 
            className="btn-icon" 
            onClick={history.redo} 
            disabled={!history.canRedo}
            title="Redo (Ctrl+Y)"
          >
            ↷
          </button>
          <div className="toolbar-divider" />
          <button className="btn-icon" onClick={collapseAll} title="Collapse All">
            ⊟
          </button>
          <button className="btn-icon" onClick={expandAll} title="Expand All">
            ⊞
          </button>
          <div className="toolbar-divider" />
          <button 
            className="btn-icon" 
            onClick={() => setZoom(z => Math.max(50, z - 10))} 
            disabled={zoom <= 50}
            title="Zoom Out"
          >
            −
          </button>
          <span className="zoom-level">{zoom}%</span>
          <button 
            className="btn-icon" 
            onClick={() => setZoom(z => Math.min(150, z + 10))} 
            disabled={zoom >= 150}
            title="Zoom In"
          >
            +
          </button>
          <button 
            className="btn-icon" 
            onClick={() => setZoom(100)} 
            title="Reset Zoom"
          >
            ⟲
          </button>
        </div>
      </div>

      {/* Search results dropdown */}
      <AnimatePresence>
        {searchResults.length > 0 && searchQuery && (
          <motion.div 
            className="search-results"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {searchResults.slice(0, 10).map(({ node, path }) => (
              <button
                key={node.id}
                className={`search-result-item ${highlightedNodeId === node.id ? 'active' : ''}`}
                onClick={() => navigateToResult(node.id)}
              >
                <span className="search-result-cidr">{node.cidr}</span>
                {node.label && <span className="search-result-label">{node.label}</span>}
                <span className="search-result-path">{path.length > 0 ? path.map(p => p.split('/')[0]).join(' → ') : 'root'}</span>
              </button>
            ))}
            {searchResults.length > 10 && (
              <div className="search-results-more">
                +{searchResults.length - 10} more results
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* IP Address Bar */}
      <IPAddressBar root={safeRoot} />

      <div className="tree-container" ref={canvasRef}>
        {/* Minimap */}
        <Minimap 
          root={safeRoot} 
          containerRef={canvasRef}
          onNavigate={(left, top) => {
            if (canvasRef.current) {
              canvasRef.current.scrollTo({ left, top, behavior: 'smooth' })
            }
          }}
        />

        <AnimatePresence mode="popLayout">
          <div className="tree-content" style={{ zoom: zoom / 100 }}>
            {renderNode(safeRoot, 0)}
          </div>
        </AnimatePresence>
      </div>
      
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
              setEditingNotes(null)
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
                  // Blur active element to trigger save handlers
                  if (document.activeElement instanceof HTMLElement) {
                    document.activeElement.blur()
                  }
                  setTimeout(() => {
                    setSelectedNode(null)
                    setEditingLabel(null)
                    setEditingNotes(null)
                  }, 10)
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

              {/* Notes section */}
              <div className="notes-section">
                <span className="modal-label">Notes</span>
                {editingNotes === selectedNode.id ? (
                  <div className="notes-edit-form">
                    <textarea
                      ref={notesInputRef}
                      className="notes-input"
                      value={notesInput}
                      onChange={(e) => setNotesInput(e.target.value)}
                      placeholder="Add notes about this subnet..."
                      rows={3}
                      onBlur={() => {
                        updateNodeNotes(selectedNode.id, notesInput)
                        setEditingNotes(null)
                      }}
                      onKeyDown={(e) => {
                        // Save on Ctrl+Enter or Cmd+Enter
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                          updateNodeNotes(selectedNode.id, notesInput)
                          setEditingNotes(null)
                        }
                      }}
                    />
                  </div>
                ) : (
                  <button
                    className="btn-notes"
                    onClick={() => {
                      setEditingNotes(selectedNode.id)
                      setNotesInput(selectedNode.notes || '')
                    }}
                  >
                    {selectedNode.notes || '+ Add notes'}
                  </button>
                )}
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
                <span className="shortcut-hint">Keyboard: <kbd>S</kbd> Split <kbd>C</kbd> Combine <kbd>L</kbd> Label <kbd>N</kbd> Notes <kbd>Esc</kbd> Close</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

export default SubnetTree
