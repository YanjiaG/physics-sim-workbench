import { useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { ParamPanel } from './components/ParamPanel';
import { SceneCanvas } from './components/SceneCanvas';
import { PlayBar } from './components/PlayBar';
import { BottomTabs } from './components/BottomTabs';
import { AiPanel } from './components/AiPanel';
import { LibraryModal } from './components/LibraryModal';
import { useApp } from './store';

export function App() {
  const checkAi = useApp((state) => state.checkAi);
  const refreshLibrary = useApp((state) => state.refreshLibrary);
  const toast = useApp((state) => state.toast);

  useEffect(() => {
    void checkAi();
    void refreshLibrary();
  }, [checkAi, refreshLibrary]);

  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        <ParamPanel />
        <main className="stage">
          <SceneCanvas />
          <PlayBar />
          <BottomTabs />
        </main>
        <AiPanel />
      </div>
      <LibraryModal />
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
