import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import SubnetTree from './SubnetTree'
import { parseCidr } from './ip'

const defaultCidr = '10.0.0.0/16'
const STORAGE_KEY = 'subnet-cidr'

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
  const [error, setError] = useState('')

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, activeCidr)
  }, [activeCidr])

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
          </div>
          {error && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="helper-text" style={{ color: '#ff9e9e' }}>
              {error}
            </motion.div>
          )}
        </div>
      </div>

      <div className="canvas-shell">
        {isValid ? (
          <SubnetTree cidr={activeCidr} resetKey={resetKey} />
        ) : (
          <div className="helper-text" style={{ color: '#ff9e9e' }}>
            Please enter a valid IPv4 CIDR (example: 10.0.0.0/16).
          </div>
        )}
      </div>


    </div>
  )
}

export default App

