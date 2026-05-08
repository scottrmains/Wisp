import { LibraryPage } from './features/library/LibraryPage'
import { MiniPlayer } from './features/player/MiniPlayer'

function App() {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <LibraryPage />
      </div>
      <MiniPlayer />
    </div>
  )
}

export default App
