import { expect, it } from 'vitest'
import { youtubeLinks } from './youtubeLinks'

it('embeds videos on YouTube, preserving the case-sensitive video ID', () => {
  expect(youtubeLinks.embed('keTtiDqQrpc')).toBe('https://www.youtube.com/embed/keTtiDqQrpc')
})

it('keeps the complete track query in one YouTube search parameter', () => {
  const query = 'Brent Laurence - Big Buds & edits #1'
  const url = new URL(youtubeLinks.search(query))
  expect(url.hostname).toBe('www.youtube.com')
  expect(url.searchParams.get('search_query')).toBe(query)
  expect(url.hash).toBe('')
  expect(url.searchParams.size).toBe(1)
})
