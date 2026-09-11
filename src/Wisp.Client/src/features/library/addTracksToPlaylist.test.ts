import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import { playlists } from '../../api/playlists'
import { choiceDialog } from '../../components/dialog'
import { addTracksToPlaylist } from './addTracksToPlaylist'

vi.mock('../../api/playlists', () => ({ playlists: { addTracksBulk: vi.fn() } }))
vi.mock('../../components/dialog', () => ({ choiceDialog: vi.fn() }))
beforeEach(() => vi.resetAllMocks())
describe('playlist duplicate confirmation', () => {
  it('adds new tracks without prompting and deduplicates repeated request IDs', async () => {
    vi.mocked(playlists.addTracksBulk).mockResolvedValue({ added: 1, skipped: 0 })
    await addTracksToPlaylist('playlist', ['a', 'a'])
    expect(playlists.addTracksBulk).toHaveBeenCalledWith('playlist', ['a'])
    expect(choiceDialog).not.toHaveBeenCalled()
  })
  it.each(['add', 'skip'] as const)('sends %s only after explicit confirmation', async choice => {
    vi.mocked(playlists.addTracksBulk).mockRejectedValueOnce(new ApiError('Already present', 409, 'playlist_duplicates')).mockResolvedValueOnce({ added: 1, skipped: 0 })
    vi.mocked(choiceDialog).mockResolvedValue(choice)
    await addTracksToPlaylist('playlist', ['a', 'b'])
    expect(choiceDialog).toHaveBeenCalledOnce()
    expect(playlists.addTracksBulk).toHaveBeenLastCalledWith('playlist', ['a', 'b'], choice)
  })
  it('cancel makes no second request', async () => {
    vi.mocked(playlists.addTracksBulk).mockRejectedValueOnce(new ApiError('Already present', 409, 'playlist_duplicates'))
    vi.mocked(choiceDialog).mockResolvedValue(null)
    expect(await addTracksToPlaylist('playlist', ['a'])).toBeNull()
    expect(playlists.addTracksBulk).toHaveBeenCalledOnce()
  })
  it('does not retry other errors as permission to duplicate', async () => {
    vi.mocked(playlists.addTracksBulk).mockRejectedValue(new ApiError('Missing track', 400, 'track_not_found'))
    await expect(addTracksToPlaylist('playlist', ['a'])).rejects.toThrow('Missing track')
    expect(choiceDialog).not.toHaveBeenCalled()
  })
})
