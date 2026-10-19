import type { ObjectSnapshot, SimulationSnapshot, TaskSnapshot } from '@emergency/protocol';
import { useEffect } from 'react';

import { commandFor } from '../game/input/sceneInput.ts';
import { sendCommand, useGameStore, type Selection } from '../state/gameStore.ts';
import { Saves } from './Saves.tsx';

export function Hud() {
  const snapshot = useGameStore((state) => state.snapshot);
  const selection = useGameStore((state) => state.selection);
  const lastResult = useGameStore((state) => state.lastResult);
  const error = useGameStore((state) => state.error);
  const selectResponder = useGameStore((state) => state.selectResponder);
  const selectTeam = useGameStore((state) => state.selectTeam);
  const selectObject = useGameStore((state) => state.selectObject);
  const selectVehicle = useGameStore((state) => state.selectVehicle);
  const selectFire = useGameStore((state) => state.selectFire);

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
  const selectedVehicle =
    selection?.kind === 'vehicle'
      ? snapshot.vehicles.find((vehicle) => vehicle.id === selection.id)
      : undefined;
  const selectedFire =
    selection?.kind === 'fire'
      ? snapshot.fires.find((fire) => fire.id === selection.id)
      : undefined;
  const apparatus = snapshot.vehicles.find((vehicle) => vehicle.id === snapshot.team.apparatusId);
  const staging = snapshot.roads.find((road) => road.kind === 'staging');
  const openTask = selectedResponder
    ? snapshot.tasks.find(
        (task) =>
          task.assigneeId === selectedResponder.id &&
          !task.parentId &&
          (task.state === 'running' || task.state === 'suspended'),
      )
    : selectedVehicle
      ? snapshot.tasks.find(
          (task) =>
            task.assigneeId === selectedVehicle.id &&
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
        <Saves />
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
                    {statusFor(memberTasks(snapshot.tasks, memberId))}
                    {entity
                      ? ` · ${entity.position.x.toFixed(1)}, ${entity.position.y.toFixed(1)}`
                      : ''}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>

        <ul className="roster">
          {snapshot.vehicles.map((vehicle) => (
            <li key={vehicle.id}>
              <button
                type="button"
                aria-pressed={selection?.kind === 'vehicle' && selection.id === vehicle.id}
                onClick={() => selectVehicle(vehicle.id)}
              >
                <span>{vehicle.name}</span>
                <small>
                  {vehicle.status} · {vehicle.position.x.toFixed(1)},{' '}
                  {vehicle.position.y.toFixed(1)} · {vehicle.occupants.length}/{vehicle.capacity}{' '}
                  seats ·{' '}
                  {vehicleStatus(snapshot.tasks.filter((task) => task.assigneeId === vehicle.id))}
                </small>
              </button>
            </li>
          ))}
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

        <ul className="roster">
          {snapshot.incidents.map((incident) => {
            const fireId = incident.objectives[0]?.targetId;
            const fire = snapshot.fires.find((candidate) => candidate.id === fireId);
            const order = snapshot.tasks.find(
              (task) =>
                task.kind === 'suppress-incident' &&
                task.targetId === incident.id &&
                (task.state === 'running' || task.state === 'suspended'),
            );
            return (
              <li key={incident.id}>
                <button
                  type="button"
                  aria-pressed={selection?.kind === 'fire' && selection.id === fireId}
                  onClick={() => {
                    if (fireId) selectFire(fireId);
                  }}
                >
                  <span>{incident.name}</span>
                  <small>
                    {incident.state}
                    {fire
                      ? ` · ${Math.round((fire.intensity / fire.maxIntensity) * 100)}% · fuel ${fire.fuel.toFixed(0)}`
                      : ''}
                  </small>
                </button>
                {order ? (
                  <button
                    type="button"
                    className="action"
                    onClick={() => sendCommand({ type: 'cancel-task', taskId: order.id })}
                  >
                    Cancel suppression
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>

        <div className="detail">
          {selection?.kind === 'team' ? (
            <>
              <p>
                Team selected. Right-click the map to move {snapshot.team.name}, the engine to
                board, the locker to retrieve, or the fire to suppress the incident.
              </p>
              {apparatus ? (
                <p>
                  Apparatus {apparatus.name}. Driver{' '}
                  {driverName(snapshot, apparatus.driverId) ?? 'unassigned'}. Occupants{' '}
                  {apparatus.occupants.map((occupant) => occupant.name).join(', ') || 'none'}.
                </p>
              ) : null}
              {apparatus ? (
                <button
                  type="button"
                  onClick={() =>
                    sendCommand({
                      type: 'board-team',
                      teamId: snapshot.team.id,
                      vehicleId: apparatus.id,
                    })
                  }
                >
                  Board crew
                </button>
              ) : null}
              {apparatus && staging ? (
                <button
                  type="button"
                  onClick={() =>
                    sendCommand({
                      type: 'respond-to',
                      teamId: snapshot.team.id,
                      destinationNodeId: staging.id,
                      disembark: true,
                    })
                  }
                >
                  Respond to staging
                </button>
              ) : null}
              {apparatus ? (
                <button
                  type="button"
                  onClick={() =>
                    sendCommand({
                      type: 'disembark-team',
                      teamId: snapshot.team.id,
                      vehicleId: apparatus.id,
                    })
                  }
                >
                  Disembark
                </button>
              ) : null}
              {snapshot.incidents
                .filter((incident) => incident.state === 'active')
                .map((incident) => (
                  <button
                    key={incident.id}
                    type="button"
                    onClick={() =>
                      sendCommand({
                        type: 'suppress-incident',
                        teamId: snapshot.team.id,
                        incidentId: incident.id,
                      })
                    }
                  >
                    Suppress {incident.name}
                  </button>
                ))}
            </>
          ) : selectedResponder ? (
            <>
              <h2>{selectedResponder.name}</h2>
              <p>
                Position {selectedResponder.position.x.toFixed(1)},{' '}
                {selectedResponder.position.y.toFixed(1)}
              </p>
              <p>{statusFor(memberTasks(snapshot.tasks, selectedResponder.id))}</p>
              <p>
                Carrying{' '}
                {selectedResponder.inventory.length > 0
                  ? selectedResponder.inventory.map((item) => carriedLabel(item)).join(', ')
                  : 'nothing'}{' '}
                ({selectedResponder.inventory.length}/{snapshot.inventoryCapacity})
              </p>
              {selectedResponder.aboardVehicleId ? (
                <p>Aboard {vehicleName(snapshot, selectedResponder.aboardVehicleId)}</p>
              ) : null}
              {apparatus && selectedResponder.aboardVehicleId === apparatus.id ? (
                <button
                  type="button"
                  onClick={() =>
                    sendCommand({
                      type: 'exit-vehicle',
                      responderId: selectedResponder.id,
                      vehicleId: apparatus.id,
                    })
                  }
                >
                  Exit vehicle
                </button>
              ) : null}
              {apparatus && !selectedResponder.aboardVehicleId ? (
                <button
                  type="button"
                  onClick={() =>
                    sendCommand({
                      type: 'board-vehicle',
                      responderId: selectedResponder.id,
                      vehicleId: apparatus.id,
                    })
                  }
                >
                  Board vehicle
                </button>
              ) : null}
              {apparatus && !selectedResponder.aboardVehicleId
                ? apparatus.contents
                    .filter((item) => !item.reserved)
                    .map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() =>
                          sendCommand({
                            type: 'retrieve-equipment',
                            responderId: selectedResponder.id,
                            lockerId: apparatus.id,
                            definitionId: item.definitionId,
                          })
                        }
                      >
                        Retrieve {item.name} from {apparatus.name}
                      </button>
                    ))
                : null}
              {snapshot.fires
                .filter((fire) => !fire.out)
                .map((fire) => (
                  <button
                    key={fire.id}
                    type="button"
                    onClick={() =>
                      sendCommand({
                        type: 'suppress-fire',
                        responderId: selectedResponder.id,
                        fireId: fire.id,
                      })
                    }
                  >
                    Suppress {fire.name}
                  </button>
                ))}
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
          ) : selectedVehicle ? (
            <>
              <h2>{selectedVehicle.name}</h2>
              <p>
                {selectedVehicle.status}
                {selectedVehicle.destinationNodeId
                  ? ` · destination ${selectedVehicle.destinationNodeId}`
                  : ''}
                {' · '}
                {selectedVehicle.occupants.length}/{selectedVehicle.capacity} seats
              </p>
              <p>Driver {driverName(snapshot, selectedVehicle.driverId) ?? 'none'}</p>
              <p>
                Occupants{' '}
                {selectedVehicle.occupants.map((occupant) => occupant.name).join(', ') || 'none'}
              </p>
              <p>
                Team {snapshot.team.name}:{' '}
                {snapshot.team.memberIds
                  .map(
                    (memberId) => snapshot.entities.find((entity) => entity.id === memberId)?.name,
                  )
                  .filter((name): name is string => Boolean(name))
                  .join(', ')}
              </p>
              <p>
                {selectedVehicle.contents.length > 0
                  ? selectedVehicle.contents
                      .map((item) => `${item.name}${item.reserved ? ' (reserved)' : ''}`)
                      .join(', ')
                  : 'No stored equipment'}
              </p>
              <p>
                {vehicleStatus(
                  snapshot.tasks.filter((task) => task.assigneeId === selectedVehicle.id),
                )}
              </p>
              {staging ? (
                <button
                  type="button"
                  onClick={() =>
                    sendCommand({
                      type: 'drive-vehicle',
                      vehicleId: selectedVehicle.id,
                      destinationNodeId: staging.id,
                    })
                  }
                >
                  Drive to staging
                </button>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  sendCommand({
                    type: 'disembark-team',
                    teamId: snapshot.team.id,
                    vehicleId: selectedVehicle.id,
                  })
                }
              >
                Disembark
              </button>
              {openTask ? (
                <button
                  type="button"
                  onClick={() => sendCommand({ type: 'cancel-task', taskId: openTask.id })}
                >
                  Cancel task
                </button>
              ) : null}
            </>
          ) : selectedFire ? (
            <>
              <h2>{selectedFire.name}</h2>
              <p>
                {selectedFire.out
                  ? 'Out'
                  : `${Math.round((selectedFire.intensity / selectedFire.maxIntensity) * 100)}% intensity`}
                {' · '}fuel {selectedFire.fuel.toFixed(1)}
              </p>
              <p>
                {incidentFor(snapshot, selectedFire.id)?.state ?? 'No incident'} ·{' '}
                {incidentFor(snapshot, selectedFire.id)?.name ?? 'unassigned'}
              </p>
              <p>Select a responder or the team, then suppress this fire.</p>
            </>
          ) : (
            <p>Select a responder, or select the team.</p>
          )}
          <p className="help">
            Left-click selects. Right-click moves, boards, interacts, or suppresses. Space pauses.
            Wheel zooms. Middle mouse pans.
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

function memberTasks(tasks: TaskSnapshot[], memberId: string): TaskSnapshot[] {
  return tasks.filter(
    (task) =>
      task.assigneeId === memberId &&
      task.kind !== 'interact' &&
      (task.kind === 'board-vehicle' ||
        task.kind === 'exit-vehicle' ||
        task.kind === 'suppress-fire' ||
        !task.parentId),
  );
}

function vehicleStatus(tasks: TaskSnapshot[]): string {
  const active = statusFor(tasks);
  const notice = [...tasks]
    .reverse()
    .find((task) => (task.state === 'failed' || task.state === 'cancelled') && task.failureReason);
  if (!notice?.failureReason) return active;
  if (active === 'Idle') return `${notice.state}: ${notice.failureReason}`;
  return `${active} · ${notice.failureReason}`;
}

function driverName(snapshot: SimulationSnapshot, driverId: string | null): string | null {
  if (!driverId) return null;
  return snapshot.entities.find((entity) => entity.id === driverId)?.name ?? driverId;
}

function vehicleName(snapshot: SimulationSnapshot, vehicleId: string): string {
  return snapshot.vehicles.find((vehicle) => vehicle.id === vehicleId)?.name ?? vehicleId;
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

function incidentFor(snapshot: SimulationSnapshot, fireId: string) {
  return snapshot.incidents.find((incident) =>
    incident.objectives.some((objective) => objective.targetId === fireId),
  );
}

function carriedLabel(item: { name: string; agent?: number }): string {
  return item.agent === undefined ? item.name : `${item.name} (${item.agent})`;
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
          : task.kind === 'board-vehicle'
            ? 'Board'
            : task.kind === 'exit-vehicle'
              ? 'Exit vehicle'
              : task.kind === 'drive-vehicle'
                ? 'Drive'
                : task.kind === 'respond'
                  ? 'Respond'
                  : task.kind === 'suppress-fire'
                    ? 'Suppress'
                    : task.kind === 'suppress-incident'
                      ? 'Suppress incident'
                      : 'Interact';
  const progress = task.durationTicks > 0 ? ` ${task.progressTicks}/${task.durationTicks}` : '';
  const reason = task.state === 'failed' && task.failureReason ? `: ${task.failureReason}` : '';
  return `${label} ${state} · ${task.step}${progress}${reason}`;
}
