import { useApp } from '../store';
import { fmtDateTime } from '../lib/format';

export function LibraryModal() {
  const open = useApp((state) => state.libraryOpen);
  const library = useApp((state) => state.library);
  const setLibraryOpen = useApp((state) => state.setLibraryOpen);
  const loadSaved = useApp((state) => state.loadSaved);
  const removeSaved = useApp((state) => state.removeSaved);
  const saveCurrent = useApp((state) => state.saveCurrent);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={() => setLibraryOpen(false)}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="panel-head">
          <span className="panel-title">本地场景库</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn ghost small" onClick={() => void saveCurrent()}>
            保存当前场景
          </button>
          <button type="button" className="btn ghost small" onClick={() => setLibraryOpen(false)}>
            关闭
          </button>
        </div>
        {library.length === 0 ? (
          <div className="empty">还没有保存的场景。保存后会存在这台电脑的浏览器里。</div>
        ) : (
          <div className="library-list">
            {library.map((item) => (
              <div key={item.sceneId} className="library-item">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="library-name">{item.name}</div>
                  <div className="field-hint">
                    {item.modelId} · 更新于 {fmtDateTime(item.updatedAt)}
                  </div>
                </div>
                <button type="button" className="btn small" onClick={() => void loadSaved(item.sceneId)}>
                  打开
                </button>
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => void removeSaved(item.sceneId)}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
