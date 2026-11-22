import { useApp } from '../store';
import { fmtNumber } from '../lib/format';

export function EventList() {
  const run = useApp((state) => state.run);
  const time = useApp((state) => state.time);
  const seek = useApp((state) => state.seek);

  if (run.events.length === 0) {
    return <div className="empty">这次运行没有记录到事件。</div>;
  }

  return (
    <div>
      {run.events.map((event, index) => {
        const active = Math.abs(time - event.t) < 0.02;
        return (
          <div
            key={`${event.kind}-${event.t}-${index}`}
            className={`event${active ? ' active' : ''}`}
            onClick={() => seek(event.t)}
            role="button"
            tabIndex={0}
            onKeyDown={(keyEvent) => {
              if (keyEvent.key === 'Enter' || keyEvent.key === ' ') seek(event.t);
            }}
          >
            <span className="event-time">{fmtNumber(event.t, 3)} s</span>
            <span className="event-body">
              <span>{event.title}</span>
              <span className="event-detail">{event.detail}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
