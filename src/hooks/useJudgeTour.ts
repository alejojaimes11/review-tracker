import { useState } from 'react'

export type JudgeTourStep = 'welcome' | 'pick' | 'analysis'

const STEP_KEY = 'mp_tour_step'
const SEEN_KEY = 'mp_tour_seen'

function readStep(): JudgeTourStep | null {
  try {
    const v = localStorage.getItem(STEP_KEY)
    return v === 'welcome' || v === 'pick' || v === 'analysis' ? v : null
  } catch {
    return null
  }
}

function writeStep(step: JudgeTourStep | null) {
  try {
    if (step) localStorage.setItem(STEP_KEY, step)
    else localStorage.removeItem(STEP_KEY)
  } catch {
    /* convenience only */
  }
}

function hasSeenBefore(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* convenience only */
  }
}

/**
 * A tiny guided tour for first-time (contest judge) visitors: welcome -> pick a business -> see
 * its AI analysis. State lives in localStorage so it survives navigating from the dashboard to a
 * business's page (a route change, not a reload — each page reads the step fresh on mount).
 * Auto-starts once per browser on a first visit; the header button restarts or cancels it anytime.
 */
export function useJudgeTour(): [JudgeTourStep | null, (step: JudgeTourStep | null) => void] {
  const [step, setStepState] = useState<JudgeTourStep | null>(() => {
    const saved = readStep()
    if (saved) return saved
    if (!hasSeenBefore()) {
      markSeen()
      return 'welcome'
    }
    return null
  })

  function setStep(next: JudgeTourStep | null) {
    setStepState(next)
    writeStep(next)
  }

  return [step, setStep]
}
