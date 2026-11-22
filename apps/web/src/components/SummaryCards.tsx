import { useApp } from '../store';
import { fmtNumber } from '../lib/format';

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">
        {value}
        {unit ? <span className="field-unit"> {unit}</span> : null}
      </div>
    </div>
  );
}

export function SummaryCards() {
  const run = useApp((state) => state.run);
  const summary = run.summary;
  const applied = Number(summary.extra['work_applied_J'] ?? 0);

  return (
    <div>
      <div className="summary-grid" style={{ padding: 0, border: 0 }}>
        <Metric
          label="停止时间"
          value={summary.stop_time_s === null ? '未停止' : fmtNumber(summary.stop_time_s, 3)}
          unit={summary.stop_time_s === null ? undefined : 's'}
        />
        <Metric label="末位置" value={summary.final_position_m === null ? '—' : fmtNumber(summary.final_position_m, 3)} unit="m" />
        <Metric label="末速度" value={summary.final_velocity_m_s === null ? '—' : fmtNumber(summary.final_velocity_m_s, 3)} unit="m/s" />
        <Metric label="最大速率" value={fmtNumber(summary.max_speed_m_s, 3)} unit="m/s" />
        <Metric label="总路程" value={fmtNumber(summary.total_distance_m, 3)} unit="m" />
        <Metric label="摩擦生热" value={fmtNumber(summary.friction_heat_J, 3)} unit="J" />
        <Metric label="初动能" value={fmtNumber(summary.initial_energy_J, 3)} unit="J" />
        <Metric label="末动能" value={fmtNumber(summary.final_energy_J, 3)} unit="J" />
        {applied !== 0 ? <Metric label="外力做功" value={fmtNumber(applied, 3)} unit="J" /> : null}
        <Metric label="能量残差" value={fmtNumber(summary.energy_residual_J, 6)} unit="J" />
      </div>
      {run.warnings.length > 0 ? (
        <div style={{ marginTop: 10 }}>
          {run.warnings.map((warning) => (
            <div key={warning} className="issue warning">
              <span>!</span>
              <span>{warning}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
