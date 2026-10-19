import type { ObjectSnapshot, TaskSnapshot } from '@emergency/protocol';
import { useEffect } from 'react';

import { commandFor } from '../game/input/sceneInput.ts';
import { sendCommand, useGameStore, type Selection } from '../state/gameStore.ts';

export function Hud() {
  const snapshot = useGameStore((state) => state.snapshot);
  const selection = useGameStore((state) => state.selection);
  const lastResult = useGameStore((state) => state.lastResult);
  const error = useGameStore((state) => state.error);
  const selectResponder = useGameStore((state) => state.selectResponder);
  const selectTeam = useGameStore((state) => state.selectTeam);
  const selectObject = useGameStore((state) => state.selectObject);

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
  const selectedObject =
    selection?.kind === 'object'
      ? snapshot.objects.find((object) => object.id === selection.id)
      : undefined;
  const openTask = selectedResponder
    ? snapshot.tasks.find(
        (task) =>
          task.assigneeId === selectedResponder.id &&
          !task.parentId &&
          (task.state === 'running' || task.state === 'suspended'),
      )
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
                    {statusFor(
                      snapshot.tasks.filter(
                        (task) => task.assigneeId === memberId && !task.parentId,
                      ),
                    )}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>

        <ul className="roster">
          {snapshot.objects.map((object) => {
            const command = commandFor(selection, object);
            return (
              <li key={object.id}>
                <button
                  type="button"
                  aria-pressed={selection?.kind === 'object' && selection.id === object.id}
                  onClick={() => selectObject(object.id)}
                >
                  <span>{object.name}</span>
                  <small>
                    {object.state}
                    {object.contents.length > 0
                      ? ` · ${object.contents.map((item) => item.name).join(', ')}`
                      : ''}
                  </small>
                </button>
                {command ? (
                  <button type="button" className="action" onClick={() => sendCommand(command)}>
                    {actionLabel(object, selection)}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>

        <div className="detail">
          {selection?.kind === 'team' ? (
            <p>
              Team selected. Right-click the map to move {snapshot.team.name}, or retrieve from the
              locker.
            </p>
          ) : selectedResponder ? (
            <>
              <h2>{selectedResponder.name}</h2>
              <p>
                Position {selectedResponder.position.x.toFixed(1)},{' '}
                {selectedResponder.position.y.toFixed(1)}
              </p>
              <p>
                {statusFor(
                  snapshot.tasks.filter(
                    (task) => task.assigneeId === selectedResponder.id && !task.parentId,
                  ),
                )}
              </p>
              <p>
                Carrying{' '}
                {selectedResponder.inventory.length > 0
                  ? selectedResponder.inventory.map((item) => item.name).join(', ')
                  : 'nothing'}{' '}
                ({selectedResponder.inventory.length}/{snapshot.inventoryCapacity})
              </p>
              {openTask ? (
                <button
                  type="button"
                  onClick={() => sendCommand({ type: 'cancel-task', taskId: openTask.id })}
                >
                  Cancel task
                </button>
              ) : null}
            </>
          ) : selectedObject ? (
            <>
              <h2>{selectedObject.name}</h2>
              <p>
                {selectedObject.objectType} · {selectedObject.state}
              </p>
              {selectedObject.requiredCapability ? (
                <p>Requires {selectedObject.requiredCapability}</p>
              ) : null}
              <p>
                {selectedObject.contents.length > 0
                  ? selectedObject.contents
                      .map((item) => `${item.name}${item.reserved ? ' (reserved)' : ''}`)
                      .join(', ')
                  : 'No stored equipment'}
              </p>
              <p>Select a responder, then use the object action or right-click the object.</p>
            </>
          ) : (
            <p>Select a responder, or select the team.</p>
          )}
          <p className="help">
            Left-click selects. Right-click moves or interacts. Space pauses. Wheel zooms. Middle
            mouse pans.
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

function actionLabel(object: ObjectSnapshot, selection: Selection): string {
  if (selection?.kind === 'team' && object.objectType === 'locker') return 'Retrieve for team';
  if (object.objectType === 'door') return 'Force door';
  if (object.objectType === 'panel') return 'Operate panel';
  const item = object.contents.find((content) => !content.reserved) ?? object.contents[0];
  return item ? `Retrieve ${item.name}` : 'Retrieve';
}

function describeTask(task: TaskSnapshot): string {
  const state = task.state === 'suspended' ? 'suspended by override' : task.state;
  if (task.kind === 'move') {
    const label = task.source === 'team' ? 'Team move' : 'Override';
    return `${label} ${state} (${task.destination.x}, ${task.destination.y})`;
  }
  const label =
    task.kind === 'retrieve-equipment'
      ? 'Retrieve equipment'
      : task.kind === 'force-door'
        ? 'Force door'
        : task.kind === 'operate-panel'
          ? 'Operate panel'
          : 'Interact';
  const progress = task.durationTicks > 0 ? ` ${task.progressTicks}/${task.durationTicks}` : '';
  const reason = task.state === 'failed' && task.failureReason ? `: ${task.failureReason}` : '';
  return `${label} ${state} · ${task.step}${progress}${reason}`;
}
