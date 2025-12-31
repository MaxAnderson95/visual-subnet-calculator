import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import SubnetTree from './SubnetTree'
import { parseCidr, toSubnetNode } from './ip'
import type { SubnetNode } from './types'

// Compression utilities using native CompressionStream API
async function compress(str: string): Promise<string> {
  const byteArray = new TextEncoder().encode(str)
  const stream = new CompressionStream('deflate-raw')
  const writer = stream.writable.getWriter()
  writer.write(byteArray)
  writer.close()
  const buffer = await new Response(stream.readable).arrayBuffer()
  // Convert to base64url (URL-safe base64)
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function decompress(b64: string): Promise<string> {
  // Convert from base64url back to standard base64
  let base64 = b64.replace(/-/g, '+').replace(/_/g, '/')
  // Add padding if needed
  while (base64.length % 4) base64 += '='
  const binary = atob(base64)
  const byteArray = Uint8Array.from(binary, c => c.charCodeAt(0))
  const stream = new DecompressionStream('deflate-raw')
  const writer = stream.writable.getWriter()
  writer.write(byteArray)
  writer.close()
  const buffer = await new Response(stream.readable).arrayBuffer()
  return new TextDecoder().decode(buffer)
}

// Compact format: only store what can't be derived
// Format: [cidr, label?, color?, notes?, [children...]]
// Example: ["10.0.0.0/16", null, null, null, [["10.0.0.0/17", "Prod", "#ff0"], ["10.0.128.0/17"]]]
type CompactNode = [string, string?, string?, string?, CompactNode[]?]

function toCompact(node: SubnetNode): CompactNode {
  const result: CompactNode = [node.cidr]
  
  // Only add label if it exists
  if (node.label || node.color || node.notes || node.children?.length) {
    result.push(node.label || undefined)
  }
  
  // Only add color if it exists
  if (node.color || node.notes || node.children?.length) {
    result.push(node.color || undefined)
  }
  
  // Only add notes if it exists
  if (node.notes || node.children?.length) {
    result.push(node.notes || undefined)
  }
  
  // Only add children if they exist
  if (node.children?.length) {
    result.push(node.children.map(toCompact))
  }
  
  return result
}

function fromCompact(compact: CompactNode): SubnetNode {
  const [cidr, label, color, notes, children] = compact
  const node = toSubnetNode(cidr)
  
  if (label) node.label = label
  if (color) node.color = color
  if (notes) node.notes = notes
  if (children?.length) {
    node.children = children.map(fromCompact)
  }
  
  return node
}

const defaultCidr = '10.0.0.0/16'
const STORAGE_KEY = 'subnet-cidr'
const TREE_STORAGE_KEY = 'subnet-tree-state'

const getInitialCidr = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return saved
  } catch {}
  return defaultCidr
}

const App = () => {
  const [cidrInput, setCidrInput] = useState(getInitialCidr)
  const [activeCidr, setActiveCidr] = useState(getInitialCidr)
  const [resetKey, setResetKey] = useState(0)
  const [treeKey, setTreeKey] = useState(0)
  const [error, setError] = useState('')
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(() => !!window.location.hash.slice(1))
  const fileInputRef = useRef<HTMLInputElement>(null)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, activeCidr)
  }, [activeCidr])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const isValid = useMemo(() => {
    try {
      const trimmed = cidrInput.trim()
      parseCidr(trimmed)
      setError('')
      return true
    } catch (err) {
      setError((err as Error).message)
      return false
    }
  }, [cidrInput])

  useEffect(() => {
    if (isValid) {
      setActiveCidr(cidrInput.trim())
    }
  }, [cidrInput, isValid])

  const handleExport = () => {
    try {
      const treeData = localStorage.getItem(TREE_STORAGE_KEY)
      if (!treeData) {
        alert('No subnet data to export')
        return
      }
      
      const exportData = {
        version: 1,
        cidr: activeCidr,
        tree: JSON.parse(treeData),
        exportedAt: new Date().toISOString(),
      }
      
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `subnet-${activeCidr.replace(/\//g, '-')}-${Date.now()}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setShowExportMenu(false)
    } catch (err) {
      alert('Failed to export: ' + (err as Error).message)
    }
  }

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string
        const data = JSON.parse(content)
        
        if (!data.tree || !data.cidr) {
          throw new Error('Invalid subnet file format')
        }
        
        // Update the CIDR input and tree
        setCidrInput(data.cidr)
        localStorage.setItem(TREE_STORAGE_KEY, JSON.stringify(data.tree))
        
        // Force a re-render by incrementing reset key after a short delay
        setTimeout(() => {
          window.location.reload()
        }, 100)
        
        setShowExportMenu(false)
      } catch (err) {
        alert('Failed to import: ' + (err as Error).message)
      }
    }
    reader.readAsText(file)
    
    // Reset the input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const showToast = (message: string) => {
    setToastMessage(message)
    setTimeout(() => setToastMessage(null), 2000)
  }

  const handleCopyShareLink = async () => {
    try {
      const treeData = localStorage.getItem(TREE_STORAGE_KEY)
      if (!treeData) {
        showToast('No subnet data to share')
        return
      }
      
      // Convert to compact format - only stores CIDR, labels, colors, and structure
      const tree = JSON.parse(treeData) as SubnetNode
      const compact = toCompact(tree)
      
      // Compress with deflate and encode for URL hash
      const compressed = await compress(JSON.stringify(compact))
      const shareUrl = `${window.location.origin}${window.location.pathname}#${compressed}`
      
      await navigator.clipboard.writeText(shareUrl)
      showToast('Share link copied!')
      setShowExportMenu(false)
    } catch (err) {
      showToast('Failed to copy link')
    }
  }

  // Load from URL hash
  const loadFromUrl = useCallback(async () => {
    // Try hash-based compressed format first (new format)
    const hash = window.location.hash.slice(1)
    if (hash) {
      setIsLoading(true)
      try {
        const decompressed = await decompress(hash)
        const decoded = JSON.parse(decompressed)
        
        // Check if it's compact format (array) or old format (object)
        if (Array.isArray(decoded)) {
          // New compact format: [cidr, label?, color?, children?]
          const tree = fromCompact(decoded as CompactNode)
          setCidrInput(tree.cidr)
          setActiveCidr(tree.cidr)
          localStorage.setItem(TREE_STORAGE_KEY, JSON.stringify(tree))
          // Force SubnetTree to remount and re-read from localStorage
          setTreeKey(k => k + 1)
        } else {
          // Old format with c/t or cidr/tree keys
          const cidr = decoded.c || decoded.cidr
          const tree = decoded.t || decoded.tree
          if (cidr && tree) {
            setCidrInput(cidr)
            setActiveCidr(cidr)
            localStorage.setItem(TREE_STORAGE_KEY, JSON.stringify(tree))
            setTreeKey(k => k + 1)
          }
        }
        // Clear the hash
        window.history.replaceState({}, '', window.location.pathname)
      } catch (err) {
        console.error('Failed to load from hash:', err)
      } finally {
        setIsLoading(false)
      }
      return true
    }
    
    // Fallback to old query param formats for backwards compatibility
    const params = new URLSearchParams(window.location.search)
    const data = params.get('data')
    if (data) {
      setIsLoading(true)
      try {
        const decoded = JSON.parse(atob(data))
        if (decoded.cidr && decoded.tree) {
          setCidrInput(decoded.cidr)
          setActiveCidr(decoded.cidr)
          localStorage.setItem(TREE_STORAGE_KEY, JSON.stringify(decoded.tree))
          setTreeKey(k => k + 1)
          window.history.replaceState({}, '', window.location.pathname)
        }
      } catch (err) {
        console.error('Failed to load from URL:', err)
      } finally {
        setIsLoading(false)
      }
      return true
    }
    
    setIsLoading(false)
    return false
  }, [])

  // Load from URL on mount and listen for hash changes
  useEffect(() => {
    loadFromUrl()
    
    // Listen for hash changes (e.g., when user pastes a share URL)
    const handleHashChange = () => {
      loadFromUrl()
    }
    
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [loadFromUrl])

  return (
    <div className="app-shell">
      <div className="glow" aria-hidden />
      <div className="top-bar">
        <header className="header">
          <h1 className="title">Subnet Calculator</h1>
          <p className="subtitle">
            Visually split and explore IPv4 networks.
          </p>
        </header>

        <div className="panel">
          <div className="control-row">
            <div className="control-group">
              <label className="label" htmlFor="cidr">
                Network CIDR
              </label>
              <input
                id="cidr"
                value={cidrInput}
                onChange={(e) => setCidrInput(e.target.value)}
                placeholder="10.0.0.0/16"
                style={{ width: '200px' }}
              />
            </div>
            
            <button className="btn-secondary" onClick={() => setResetKey(k => k + 1)}>
              Reset
            </button>
            
            <div className="dropdown-wrapper" ref={exportMenuRef}>
              <button 
                className="btn-secondary"
                onClick={() => setShowExportMenu(!showExportMenu)}
              >
                Export/Import
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 6 }}>
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
              <AnimatePresence>
                {showExportMenu && (
                  <motion.div 
                    className="dropdown-menu dropdown-menu-right"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                  >
                    <button className="dropdown-item" onClick={handleExport}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                      </svg>
                      Export to JSON
                    </button>
                    <button className="dropdown-item" onClick={() => fileInputRef.current?.click()}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="17 8 12 3 7 8"></polyline>
                        <line x1="12" y1="3" x2="12" y2="15"></line>
                      </svg>
                      Import from JSON
                    </button>
                    <button className="dropdown-item" onClick={handleCopyShareLink}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="18" cy="5" r="3"></circle>
                        <circle cx="6" cy="12" r="3"></circle>
                        <circle cx="18" cy="19" r="3"></circle>
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                      </svg>
                      Copy Share Link
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleImport}
            />
          </div>
          {error && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="helper-text" style={{ color: '#ff9e9e' }}>
              {error}
            </motion.div>
          )}
        </div>
      </div>

      <div className="canvas-shell">
        {isLoading ? (
          <div className="helper-text">Loading...</div>
        ) : isValid ? (
          <SubnetTree key={treeKey} cidr={activeCidr} resetKey={resetKey} />
        ) : (
          <div className="helper-text" style={{ color: '#ff9e9e' }}>
            Please enter a valid IPv4 CIDR (example: 10.0.0.0/16).
          </div>
        )}
      </div>

      <footer className="footer">
        <p>Click on any subnet to view details. Keyboard: <kbd>S</kbd> Split <kbd>C</kbd> Combine <kbd>L</kbd> Label <kbd>N</kbd> Notes <kbd>Ctrl+Z</kbd> Undo <kbd>Ctrl+Y</kbd> Redo <kbd>Ctrl+F</kbd> Search</p>
      </footer>

      <AnimatePresence>
        {toastMessage && (
          <motion.div
            className="toast"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            {toastMessage}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default App
