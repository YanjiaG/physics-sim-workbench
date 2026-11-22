import { useMemo } from 'react';
import type { ParamSpec } from '@psw/core';
import { getModel } from '@psw/core';
import { MODEL_LIST, useApp } from '../store';
import { fmtNumber } from '../lib/format';

const GROUP_LABEL: Record<ParamSpec['group'], string> = {
  object: '对象',
  environment: '环境',
  initial: '初始条件',
  run: '运行',
};

const GROUP_ORDER: ParamSpec['group'][] = ['object', 'environment', 'initial', 'run'];

export function ParamPanel() {
  const scene = useApp((state) => state.scene);
  const issues = useApp((state) => state.issues);
  const setParam = useApp((state) => state.setParam);
  const setDuration = useApp((state) => state.setDuration);
  const selectModel = useApp((state) => state.selectModel);
  const resetParams = useApp((state) => state.resetParams);

  const model = getModel(scene.modelId);
  const grouped = useMemo(() => {
    const map = new Map<ParamSpec['group'], ParamSpec[]>();
    for (const spec of model?.parameters ?? []) {
      const list = map.get(spec.group) ?? [];
      list.push(spec);
      map.set(spec.group, list);
    }
    return map;
  }, [model]);

  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');

  return (
    <aside className="panel">
      <div className="panel-head">
        <span className="panel-title">参数</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn ghost small" onClick={resetParams}>
          重置为默认
        </button>
      </div>
      <div className="panel-body">
        <div className="model-pick">
          {MODEL_LIST.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`model-btn${item.id === scene.modelId ? ' active' : ''}`}
              onClick={() => selectModel(item.id)}
              title={item.summary}
            >
              {item.name}
            </button>
          ))}
        </div>
        {model ? <p className="field-hint">{model.summary}</p> : null}

        {errors.map((issue) => (
          <div key={`${issue.key ?? issue.message}`} className="issue error">
            <span>×</span>
            <span>{issue.message}</span>
          </div>
        ))}
        {warnings.map((issue) => (
          <div key={`${issue.key ?? issue.message}`} className="issue warning">
            <span>!</span>
            <span>{issue.message}</span>
          </div>
        ))}

        {GROUP_ORDER.map((group) => {
          const specs = grouped.get(group);
          if (!specs || specs.length === 0) return null;
          return (
            <div key={group}>
              <div className="group-title">{GROUP_LABEL[group]}</div>
              {specs.map((spec) => {
                const value = scene.params[spec.key];
                if (spec.type === 'boolean') {
                  return (
                    <label key={spec.key} className="field">
                      <span className="field-label">{spec.label}</span>
                      <span className="field-row">
                        <input
                          type="checkbox"
                          checked={Boolean(value)}
                          onChange={(event) => setParam(spec.key, event.target.checked)}
                        />
                        <span className="field-hint">{value ? '开启' : '关闭'}</span>
                      </span>
                    </label>
                  );
                }
                return (
                  <label key={spec.key} className="field">
                    <span className="field-label">
                      {spec.label}
                      {spec.unit ? <span className="field-unit">{spec.unit}</span> : null}
                    </span>
                    <span className="field-row">
                      <input
                        type="number"
                        value={typeof value === 'number' ? value : 0}
                        step={spec.step ?? 0.1}
                        min={spec.min}
                        max={spec.max}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (Number.isFinite(next)) setParam(spec.key, next);
                        }}
                      />
                      {spec.hint ? <span className="field-hint">{spec.hint}</span> : null}
                    </span>
                  </label>
                );
              })}
              {group === 'run' ? (
                <label className="field">
                  <span className="field-label">
                    模拟时长<span className="field-unit">s</span>
                  </span>
                  <span className="range-row">
                    <input
                      type="range"
                      min={0.5}
                      max={20}
                      step={0.5}
                      value={scene.settings.duration_s}
                      onChange={(event) => setDuration(Number(event.target.value))}
                    />
                    <span className="num" style={{ minWidth: 44, textAlign: 'right' }}>
                      {fmtNumber(scene.settings.duration_s, 1)}
                    </span>
                  </span>
                </label>
              ) : null}
            </div>
          );
        })}

        {model && model.assumptions.length > 0 ? (
          <>
            <div className="group-title">模型假设</div>
            {model.assumptions.map((item) => (
              <div key={item.key} className="assumption">
                <span className="assumption-lock">{item.locked ? '🔒' : '·'}</span>
                <span>
                  {item.label}
                  {item.note ? <span className="field-hint">（{item.note}）</span> : null}
                </span>
              </div>
            ))}
          </>
        ) : null}
      </div>
    </aside>
  );
}
