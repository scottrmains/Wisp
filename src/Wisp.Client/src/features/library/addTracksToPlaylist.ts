import { ApiError } from '../../api/client'
import { playlists, type PlaylistAddResult } from '../../api/playlists'
import { choiceDialog } from '../../components/dialog'

// Shared by the add dialog and sidebar drops: neither entry point silently
// skips duplicates or adds them without the user's explicit choice.
export async function addTracksToPlaylist(id: string, trackIds: string[]): Promise<PlaylistAddResult | null> {
  const ids = [...new Set(trackIds)]
  try { return await playlists.addTracksBulk(id, ids) }
  catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'playlist_duplicates') throw error
    const choice = await choiceDialog({
      title: 'Already in this playlist',
      message: `${error.message}\n\nAre you sure you want to add them again? “Add again” adds every selected track, including repeats. “Skip existing” adds only tracks that are not already in the playlist.\n\nThis never duplicates the audio files on disk.`,
      choices: [{ value: 'skip', label: 'Skip existing' }, { value: 'add', label: 'Add again' }],
    })
    if (choice !== 'add' && choice !== 'skip') return null
    return playlists.addTracksBulk(id, ids, choice)
  }
}
