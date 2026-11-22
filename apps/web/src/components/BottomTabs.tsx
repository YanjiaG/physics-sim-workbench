import { useState } from 'react';
import { CurvePanel } from './CurvePanel';
import { EventList } from './EventList';
import { SummaryCards } from './SummaryCards';
import { useApp } from '../store';

type Tab = 'curves' | 'events' | 'summary';

const TABS: { id: Tab; label: string }[] = [
  { id: 'curves', label: '曲线' },
  { id: 'events', label: '关键时刻' },
  { id: 'summary', label: '结果与能量' },
];

export function BottomTabs() {
  const [tab, setTab] = useState<Tab>('curves');
  const compare = useApp((state) => state.compare);
  const clearCompare = useApp((state) => state.clearCompare);

  return (
    <div style={{ borderTop: '1px solid var(--border)', background: 'var(--panel)', height: 214, display: 'flex', flexDirection: 'column' }}>
      <div className="chart-head" style={{ borderBottom: '1px solid var(--border)' }}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`btn small${tab === item.id ? ' primary' : ' ghost'}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {compare ? (
          <button type="button" className="btn small" onClick={clearCompare}>
            退出对比
          </button>
        ) : null}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: tab === 'curves' ? 0 : '10px 12px' }}>
        {tab === 'curves' ? <CurvePanel /> : null}
        {tab === 'events' ? <EventList /> : null}
        {tab === 'summary' ? <SummaryCards /> : null}
      </div>
    </div>
  );
}
