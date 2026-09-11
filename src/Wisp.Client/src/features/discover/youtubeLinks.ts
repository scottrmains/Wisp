export const youtubeLinks = {
  embed: (videoId: string) => `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`,
  search: (query: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
}
