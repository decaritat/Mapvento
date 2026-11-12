import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { PlaceSearchResult } from '../../app/appTypes'
import { searchPlaces } from './geocoding'

const SEARCH_ERROR_MESSAGE =
  'Die Ortssuche ist fehlgeschlagen. Prüfe deine Internetverbindung und versuche es erneut.'

export function usePlaceSearch(clearSearchLayer: () => void) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQueryState] = useState('')
  const [searchResults, setSearchResults] = useState<PlaceSearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchMessage, setSearchMessage] = useState('')
  const searchRequestRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)
  const lastSearchAtRef = useRef(0)
  const searchCacheRef = useRef(new Map<string, PlaceSearchResult[]>())
  const queryRef = useRef(searchQuery)
  const searchInput = useRef<HTMLInputElement>(null)

  const cancelSearch = useCallback((updateLoading = true) => {
    requestIdRef.current += 1
    searchRequestRef.current?.abort()
    searchRequestRef.current = null
    if (updateLoading) setSearchLoading(false)
  }, [])

  useEffect(() => {
    if (searchOpen) searchInput.current?.focus()
  }, [searchOpen])

  useEffect(() => () => cancelSearch(false), [cancelSearch])

  const setSearchQuery = useCallback((query: string) => {
    if (query !== queryRef.current) {
      queryRef.current = query
      cancelSearch()
      setSearchResults([])
      setSearchMessage('')
    }
    setSearchQueryState(query)
  }, [cancelSearch])

  const closeSearch = useCallback(() => {
    cancelSearch()
    setSearchOpen(false)
    clearSearchLayer()
  }, [cancelSearch, clearSearchLayer])

  const searchPlacesForQuery = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const query = queryRef.current.trim()
    if (!query) {
      setSearchMessage('Gib einen Ortsnamen ein.')
      return
    }

    cancelSearch()
    const cacheKey = query.toLocaleLowerCase()
    const cachedResults = searchCacheRef.current.get(cacheKey)
    if (cachedResults) {
      setSearchResults(cachedResults)
      setSearchMessage(cachedResults.length ? '' : 'Keine passenden Orte gefunden.')
      return
    }

    const wait = 1000 - (Date.now() - lastSearchAtRef.current)
    if (wait > 0) {
      setSearchMessage('Bitte warte einen Moment, bevor du erneut suchst.')
      return
    }

    const controller = new AbortController()
    const requestId = requestIdRef.current
    searchRequestRef.current = controller
    lastSearchAtRef.current = Date.now()
    setSearchLoading(true)
    setSearchMessage('')
    setSearchResults([])
    clearSearchLayer()

    try {
      const results = await searchPlaces(query, controller.signal)
      if (requestId !== requestIdRef.current) return
      searchCacheRef.current.set(cacheKey, results)
      setSearchResults(results)
      setSearchMessage(results.length ? '' : 'Keine passenden Orte gefunden.')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (requestId === requestIdRef.current) setSearchMessage(SEARCH_ERROR_MESSAGE)
    } finally {
      if (requestId === requestIdRef.current) {
        searchRequestRef.current = null
        setSearchLoading(false)
      }
    }
  }, [cancelSearch, clearSearchLayer])

  return {
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    searchResults,
    searchLoading,
    searchMessage,
    setSearchMessage,
    searchInput,
    closeSearch,
    searchPlaces: searchPlacesForQuery,
  }
}
