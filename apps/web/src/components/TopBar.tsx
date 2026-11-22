import { createScene } from '@psw/core';
import { useApp } from '../store';
import { exportSceneJSON, exportStagePNG } from '../lib/export';

export function TopBar() {
  const scene = useApp((state) => state.scene);
  const rename = useApp((state) => state.rename);
  const setScene = useApp((state) => state.setScene);
  const saveCurrent = useApp((state) => state.saveCurrent);
  const setLibraryOpen = useApp((state) => state.setLibraryOpen);
  const notify = useApp((state) => state.notify);
  const aiEnabled = useApp((state) => state.aiEnabled);

  const createNew = () => {
    setScene(createScene(scene.modelId));
    notify('已新建场景');
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-dot" />
        <span className="brand-name">物理仿真工作台</span>
        <span className="brand-version">v0.1</span>
      </div>
      <input
        className="scene-name"
        value={scene.name}
        onChange={(event) => rename(event.target.value)}
        aria-label="场景名称"
      />
      <span className="chip">修订 r{scene.revision}</span>
      <span style={{ flex: 1 }} />
      <span className="chip" title={aiEnabled ? 'AI 服务可用' : '未配置 API 密钥，使用离线规则解析'}>
        {aiEnabled ? 'AI 在线' : 'AI 离线'}
      </span>
      <button type="button" className="btn ghost small" onClick={createNew}>
        新建
      </button>
      <button type="button" className="btn ghost small" onClick={() => setLibraryOpen(true)}>
        场景库
      </button>
      <button type="button" className="btn ghost small" onClick={() => void saveCurrent()}>
        保存
      </button>
      <button type="button" className="btn ghost small" onClick={() => exportSceneJSON(scene)}>
        导出 JSON
      </button>
      <button type="button" className="btn ghost small" onClick={() => exportStagePNG(scene.name)}>
        导出 PNG
      </button>
    </header>
  );
}
