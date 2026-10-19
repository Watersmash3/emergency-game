import type { TaskSnapshot } from '@emergency/protocol';
import { useEffect } from 'react';

import { sendCommand, useGameStore } from '../state/gameStore.ts';

export function Hud() {
  const snapshot = useGameStore((state) => state.snapshot);
  const selection = useGameStore((state) => state.selection);
  const lastResult = useGameStore((state) => state.lastResult);
  const error = useGameStore((state) => state.error);
  const selectResponder = useGameStore((state) => state.selectResponder);
  const selectTeam = useGameStore((state) => state.selectTeam);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('button, input, textarea')) return;
      event.preventDefault();
      const paused = useGameStore.getState().snapshot?.paused ?? false;
      sendCommand({ type: paused ? 'resume' : 'pause' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!snapshot) {
    return (
      <div className="hud">
        <p className="loading">{error ?? 'Starting simulation…'}</p>
      </div>
    );
  }

  const selectedResponder =
    selection?.kind === 'responder'
      ? snapshot.entities.find((entity) => entity.id === selection.id)
      : undefined;

  return (
    <div className="hud">
      <header className="topbar">
        <div>
          <p className="eyebrow">Incident command</p>
          <h1>{snapshot.scenarioId === 'training-yard' ? 'Training Yard' : snapshot.scenarioId}</h1>
        </div>
        <button
          type="button"
          onClick={() => sendCommand({ type: snapshot.paused ? 'resume' : 'pause' })}
        >
          {snapshot.paused ? 'Resume' : 'Pause'}
        </button>
        <p className="readout" data-paused={snapshot.paused} data-tick={snapshot.tick}>
          {snapshot.paused ? 'Paused' : 'Running'} · {snapshot.tickRate} ticks/s · Tick{' '}
          {snapshot.tick}
        </p>
      </header>

      <aside className="panel">
        <button
          type="button"
          className="team-select"
          aria-pressed={selection?.kind === 'team'}
          onClick={() => selectTeam(snapshot.team.id)}
        >
          {snapshot.team.name}
        </button>
        <ul className="roster">
          {snapshot.team.memberIds.map((memberId) => {
            const entity = snapshot.entities.find((candidate) => candidate.id === memberId);
            const selected = selection?.kind === 'responder' && selection.id === memberId;
            return (
              <li key={memberId}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => selectResponder(memberId)}
                >
                  <span>{entity?.name ?? memberId}</span>
                  <small>
                    {statusFor(snapshot.tasks.filter((task) => task.assigneeId === memberId))}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="detail">
          {selection?.kind === 'team' ? (
            <p>Team selected. Right-click the map to move {snapshot.team.name}.</p>
          ) : selectedResponder ? (
            <>
              <h2>{selectedResponder.name}</h2>
              <p>
                Position {selectedResponder.position.x.toFixed(1)},{' '}
                {selectedResponder.position.y.toFixed(1)}
              </p>
              <p>
                {statusFor(
                  snapshot.tasks.filter((task) => task.assigneeId === selectedResponder.id),
                )}
              </p>
            </>
          ) : (
            <p>Select a responder, or select the team.</p>
          )}
          <p className="help">
            Left-click selects. Right-click moves. Space pauses. Wheel zooms. Middle mouse pans.
          </p>
        </div>

        <p className={lastResult?.ok === false ? 'result error' : 'result'}>
          {error ??
            (lastResult
              ? lastResult.ok
                ? 'Order accepted'
                : (lastResult.reason ?? 'Order rejected')
              : `${snapshot.entities.length} responders`)}
        </p>
      </aside>
    </div>
  );
}

function statusFor(tasks: TaskSnapshot[]): string {
  const relevant = tasks.filter(
    (task) => task.state === 'running' || task.state === 'suspended' || task.state === 'failed',
  );
  if (relevant.length === 0) return 'Idle';
  return relevant.map(describeTask).join(' · ');
}

function describeTask(task: TaskSnapshot): string {
  const label = task.source === 'team' ? 'Team move' : 'Override';
  return `${label} ${task.state} (${task.destination.x}, ${task.destination.y})`;
}
