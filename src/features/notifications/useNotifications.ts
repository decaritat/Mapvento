import { useCallback, useEffect, useState } from 'react'

export function useNotifications(initialWarning: string) {
  const [notice, setNotice] = useState('')
  const [problems, setProblems] = useState<string[]>(() => initialWarning ? [initialWarning] : [])

  const reportProblem = useCallback((message: string) => {
    setProblems((current) => current.includes(message) ? current : [...current, message])
  }, [])
  const dismissProblem = useCallback((message: string) => {
    setProblems((current) => current.filter((item) => item !== message))
  }, [])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 4000)
    return () => window.clearTimeout(timeout)
  }, [notice])

  return { notice, setNotice, problems, reportProblem, dismissProblem }
}
