import { useState, useCallback, useRef } from 'react'

export interface HistoryState<T> {
  current: T
  set: (value: T) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  reset: (value: T) => void
}

const MAX_HISTORY = 50

export function useHistory<T>(initialValue: T): HistoryState<T> {
  const [current, setCurrent] = useState<T>(initialValue)
  const historyRef = useRef<T[]>([initialValue])
  const indexRef = useRef(0)

  const set = useCallback((value: T) => {
    // Remove any redo history when making a new change
    historyRef.current = historyRef.current.slice(0, indexRef.current + 1)
    
    // Add new state
    historyRef.current.push(value)
    
    // Limit history size
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift()
    } else {
      indexRef.current++
    }
    
    setCurrent(value)
  }, [])

  const undo = useCallback(() => {
    if (indexRef.current > 0) {
      indexRef.current--
      setCurrent(historyRef.current[indexRef.current])
    }
  }, [])

  const redo = useCallback(() => {
    if (indexRef.current < historyRef.current.length - 1) {
      indexRef.current++
      setCurrent(historyRef.current[indexRef.current])
    }
  }, [])

  const reset = useCallback((value: T) => {
    historyRef.current = [value]
    indexRef.current = 0
    setCurrent(value)
  }, [])

  return {
    current,
    set,
    undo,
    redo,
    canUndo: indexRef.current > 0,
    canRedo: indexRef.current < historyRef.current.length - 1,
    reset,
  }
}
