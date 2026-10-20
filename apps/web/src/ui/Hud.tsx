import type { SimulationSnapshot, TaskSnapshot } from '@emergency/protocol';
import { useEffect } from 'react';

import { sendCommand, useGameStore, type Selection } from '../state/gameStore.ts';
import { commandActions, type CommandAction, type CommandGroup } from './commands.ts';
import { Saves } from './Saves.tsx';

const GROUPS: { id: CommandGroup; label: string }[] = [
  { id: 'movement', label: 'Movement' },
  { id: 'team', label: 'Team' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'apparatus', label: 'Apparatus' },
  { id: 'incident', label: 'Incident' },
];

export function Hud() {
  const snapshot = useGameStore((state) => state.snapshot);
  const selection = useGameStore((state) => state.selection);
  const lastResult = useGameStore((state) => state.lastResult);
  const error = useGameStore((state) => state.error);
  const follow = useGameStore((state) => state.follow);
  const debug = useGameStore((state) => state.debug);
  const savesOpen = useGameStore((state) => state.savesOpen);
  const settingsOpen = useGameStore((state) => state.settingsOpen);
  const rosterOpen = useGameStore((state) => state.rosterOpen);
  const detailOpen = useGameStore((state) => state.detailOpen);
  const commandMode = useGameStore((state) => state.commandMode);
  const roofMode = useGameStore((state) => state.roofMode);
  const focusRoomId = useGameStore((state) => state.focusRoomId);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const typing = target instanceof HTMLElement && Boolean(target.closest('input, textarea'));
      if (event.code === 'Escape') {
        useGameStore.getState().setSavesOpen(false);
        useGameStore.getState().setSettingsOpen(false);
        useGameStore.getState().clearSelection();
        return;
      }
      if (typing) return;
      if (event.code === 'Space') {
        event.preventDefault();
        const paused = useGameStore.getState().snapshot?.paused ?? false;
        sendCommand({ type: paused ? 'resume' : 'pause' });
      } else if (event.code === 'Home') {
        event.preventDefault();
        useGameStore.getState().requestCamera('fit');
      } else if (event.code === 'KeyF') {
        useGameStore.getState().requestCamera('focus');
      } else if (event.code === 'KeyG') {
        useGameStore.getState().toggleFollow();
      } else if (event.code === 'KeyD') {
        useGameStore.getState().toggleDebug();
      } else if (event.code === 'Backspace') {
        event.preventDefault();
        cancelSelection();
      }
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

  const actions = commandActions(snapshot, selection, focusRoomId);
  const notices = [...snapshot.notices].reverse().slice(0, 4);

  return (
    <div className="hud">
      <header className="topbar">
        <div className="brand">
          <span className="mark-icon" aria-hidden="true">
            ▣
          </span>
          <h1>Incident command</h1>
        </div>
        <p className="scenario" data-scenario={snapshot.scenarioId}>
          {titleFor(snapshot.scenarioId)}
        </p>
        <div className="readout">
          <span className="status-pill" data-paused={snapshot.paused}>
            <StatusMark tone={snapshot.paused ? 'unavailable' : 'ready'} />
            {snapshot.paused ? 'Paused' : 'Running'}
          </span>
          <span data-tick={snapshot.tick}>
            {clock(snapshot.tick, snapshot.tickRate)} · {snapshot.tickRate} ticks/s
          </span>
          <button
            type="button"
            title="Space"
            onClick={() => sendCommand({ type: snapshot.paused ? 'resume' : 'pause' })}
          >
            {snapshot.paused ? 'Resume' : 'Pause'}
          </button>
          <button type="button" title="Save and load" onClick={() => useGameStore.getState().setSavesOpen(true)}>
            Saves
          </button>
          <button
            type="button"
            title="Camera, debug, and shortcuts"
            aria-pressed={settingsOpen}
            onClick={() => useGameStore.getState().setSettingsOpen(!settingsOpen)}
          >
            Settings
          </button>
        </div>
      </header>

      {settingsOpen ? (
        <div className="settings">
          <label>
            <input type="checkbox" checked={follow} onChange={() => useGameStore.getState().toggleFollow()} />
            Camera follow (G)
          </label>
          <label>
            <input type="checkbox" checked={debug} onChange={() => useGameStore.getState().toggleDebug()} />
            Debug view (D)
          </label>
          <button type="button" title="Home" onClick={() => useGameStore.getState().requestCamera('fit')}>
            Reset camera
          </button>
          <button type="button" title="F" onClick={() => useGameStore.getState().requestCamera('focus')}>
            Zoom to selection
          </button>
          <div className="roof">
            <span>Roof</span>
            {(['auto', 'open', 'closed'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={roofMode === mode}
                onClick={() => useGameStore.getState().setRoofMode(mode)}
              >
                {mode === 'auto' ? 'Auto' : mode === 'open' ? 'Open' : 'Closed'}
              </button>
            ))}
          </div>
          <p className="help">
            Wheel zooms. Middle mouse pans. Shift queues a move or interaction. Drag selects responders.
            Backspace cancels. Escape clears the selection.
          </p>
        </div>
      ) : null}

      {rosterOpen ? (
        <aside className="panel roster-panel">
          <header>
            <h2>Units</h2>
            <button type="button" title="Collapse roster" onClick={() => useGameStore.getState().toggleRoster()}>
              Hide
            </button>
          </header>
          <UnitList snapshot={snapshot} selection={selection} />
        </aside>
      ) : (
        <button className="tab" type="button" style={{ position: 'absolute', top: 64, left: 12 }} onClick={() => useGameStore.getState().toggleRoster()}>
          Units
        </button>
      )}

      {detailOpen ? (
        <aside className="panel detail-panel">
          <header>
            <h2>Selection</h2>
            <button type="button" title="Collapse details" onClick={() => useGameStore.getState().toggleDetail()}>
              Hide
            </button>
          </header>
          <IncidentCard snapshot={snapshot} />
          <BuildingCard snapshot={snapshot} focusRoomId={focusRoomId} />
          <SelectionCard snapshot={snapshot} selection={selection} />
        </aside>
      ) : (
        <button className="tab" type="button" style={{ position: 'absolute', top: 64, right: 12 }} onClick={() => useGameStore.getState().toggleDetail()}>
          Selection
        </button>
      )}

      <div className="feed" aria-live="polite">
        <ul className="feed-list">
          {notices.map((notice) => (
            <li key={notice.id} data-tone={notice.tone}>
              {notice.message}
            </li>
          ))}
          {lastResult && !lastResult.ok ? (
            <li data-tone="warning">{lastResult.reason ?? 'Order rejected'}</li>
          ) : null}
          {error ? <li data-tone="warning">{error}</li> : null}
        </ul>
      </div>

      <footer className="commandbar">
        <div className="command-head">
          <h2>Tactical commands</h2>
          {commandMode === 'move' ? <p className="hint">Click the map to move. Shift queues.</p> : null}
        </div>
        {GROUPS.map((group) => {
          const items = actions.filter((action) => action.group === group.id);
          if (items.length === 0) return null;
          return (
            <div className="command-group" key={group.id}>
              <span>{group.label}</span>
              <div>
                {items.map((action) => (
                  <CommandButton key={action.id} action={action} armed={commandMode === 'move' && action.id === 'move'} />
                ))}
              </div>
            </div>
          );
        })}
      </footer>

      {savesOpen ? (
        <div className="modal-root" onClick={() => useGameStore.getState().setSavesOpen(false)}>
          <div
            className="modal"
            role="dialog"
            aria-label="Saves"
            onClick={(event) => event.stopPropagation()}
          >
            <Saves />
            <button type="button" onClick={() => useGameStore.getState().setSavesOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CommandButton({ action, armed }: { action: CommandAction; armed: boolean }) {
  return (
    <button
      type="button"
      title={action.title}
      disabled={!action.enabled}
      className={armed ? 'active' : undefined}
      onClick={() => {
        if (!action.enabled) return;
        if (action.id === 'move') {
          const mode = useGameStore.getState().commandMode;
          useGameStore.getState().setCommandMode(mode === 'move' ? null : 'move');
          return;
        }
        for (const command of action.commands) sendCommand(command);
      }}
    >
      {action.label}
    </button>
  );
}

function UnitList({ snapshot, selection }: { snapshot: SimulationSnapshot; selection: Selection }) {
  const apparatus = snapshot.vehicles.find((vehicle) => vehicle.id === snapshot.team.apparatusId);
  const staging = snapshot.roads.find((road) => road.kind === 'staging');
  return (
    <ul className="unit-list">
      {apparatus ? (
        <li>
          <div className="unit">
            <button
              type="button"
              aria-pressed={selection?.kind === 'vehicle' && selection.id === apparatus.id}
              onClick={() => {
                useGameStore.getState().selectVehicle(apparatus.id);
                useGameStore.getState().requestCamera('focus');
              }}
            >
              <span className="who">
                <strong>{apparatus.name}</strong>
                <small>
                  {snapshot.team.memberIds.length} crew · {vehiclePosture(apparatus.status, apparatus.nodeId, staging?.id)}
                </small>
              </span>
            </button>
            <button type="button" title="Focus camera (F)" onClick={() => focusVehicle(apparatus.id)}>
              Focus
            </button>
          </div>
        </li>
      ) : null}
      <li>
        <button
          type="button"
          className="unit"
          aria-pressed={selection?.kind === 'team'}
          onClick={() => {
            useGameStore.getState().selectTeam(snapshot.team.id);
            useGameStore.getState().requestCamera('focus');
          }}
        >
          <span className="who">
            <strong>{snapshot.team.name}</strong>
            <small>Team</small>
          </span>
        </button>
      </li>
      {snapshot.team.memberIds.map((memberId) => {
        const entity = snapshot.entities.find((candidate) => candidate.id === memberId);
        if (!entity) return null;
        const selected = selection?.kind === 'responders' && selection.ids.includes(memberId);
        const posture = responderPosture(snapshot, entity.id);
        const progress = progressFor(snapshot, entity.id);
        return (
          <li key={memberId}>
            <div className="unit">
              <button
                type="button"
                aria-pressed={selected}
                onClick={(event) => {
                  const additive = event.shiftKey || event.ctrlKey || event.metaKey;
                  useGameStore.getState().selectResponders([memberId], additive, additive);
                  if (!additive) useGameStore.getState().requestCamera('focus');
                }}
              >
                <span className="who">
                  <strong>{entity.name}</strong>
                  <small className="status" data-tone={posture.tone}>
                    <i />
                    {posture.label}
                    {assignment(snapshot, entity.id) ? ` · ${assignment(snapshot, entity.id)}` : ''}
                  </small>
                  {progress ? (
                    <span className="progress" aria-label={`${progress.label} ${progress.percent}%`}>
                      <span style={{ width: `${progress.percent}%` }} />
                    </span>
                  ) : null}
                </span>
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function IncidentCard({ snapshot }: { snapshot: SimulationSnapshot }) {
  const incident = snapshot.incidents.find((item) => item.state === 'active') ?? snapshot.incidents[0];
  const fire = snapshot.fires.find((item) => incident?.objectives.some((objective) => objective.targetId === item.id));
  if (!incident) return null;
  return (
    <section className="detail">
      <h3>Active incident</h3>
      <p>
        <strong>{incident.name}</strong>
      </p>
      <p className="status" data-tone={incident.state === 'active' ? 'danger' : 'ready'}>
        <i />
        {incident.state === 'active' ? 'Active' : 'Resolved'}
        {fire && !fire.out ? ` · ${Math.round((fire.intensity / fire.maxIntensity) * 100)}%` : ' · out'}
      </p>
      <button
        type="button"
        title="Zoom to the incident"
        onClick={() => {
          if (fire) useGameStore.getState().selectFire(fire.id);
          useGameStore.getState().requestCamera('focus');
        }}
      >
        Zoom to incident
      </button>
    </section>
  );
}

function BuildingCard({
  snapshot,
  focusRoomId,
}: {
  snapshot: SimulationSnapshot;
  focusRoomId: string | null;
}) {
  if (snapshot.buildings.length === 0) return null;
  return (
    <section className="detail">
      {snapshot.buildings.map((building) => (
        <div key={building.id}>
          <h3>{building.name}</h3>
          <ul className="queue">
            {building.rooms.map((roomId) => {
              const room = snapshot.rooms.find((candidate) => candidate.id === roomId);
              if (!room) return null;
              const status =
                room.state === 'searched'
                  ? 'Searched'
                  : room.state === 'searching'
                    ? 'Searching'
                    : room.state === 'blocked'
                      ? 'Blocked'
                      : room.discovered
                        ? 'Explored'
                        : 'Unexplored';
              return (
                <li key={room.id}>
                  <button type="button" onClick={() => useGameStore.getState().setFocusRoom(room.id)}>
                    {room.id === focusRoomId ? '▸ ' : ''}
                    {room.name}
                  </button>
                  <small>
                    {status}
                    {room.discoveries.some((discovery) => discovery.found)
                      ? ` · ${room.discoveries
                          .filter((discovery) => discovery.found)
                          .map((discovery) => discovery.name)
                          .join(', ')}`
                      : ''}
                  </small>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

function SelectionCard({ snapshot, selection }: { snapshot: SimulationSnapshot; selection: Selection }) {
  if (selection?.kind === 'responders') {
    const people = selection.ids
      .map((id) => snapshot.entities.find((entity) => entity.id === id))
      .filter((entity) => entity !== undefined);
    const orders = snapshot.orders.filter((order) => selection.ids.includes(order.assigneeId));
    return (
      <section className="detail">
        <h3>{people.length === 1 ? people[0]?.name : `${people.length} responders`}</h3>
        {people.map((entity) => (
          <p key={entity.id}>
            {entity.name} · {responderPosture(snapshot, entity.id).label}
            {entity.aboardVehicleId ? ` · aboard ${nameOf(snapshot, entity.aboardVehicleId)}` : ''}
            {entity.inventory.length > 0
              ? ` · ${entity.inventory.map((item) => item.name).join(', ')}`
              : ' · no equipment'}
          </p>
        ))}
        {orders.length > 0 ? (
          <ul className="queue">
            {orders.map((order, index) => (
              <li key={order.id}>
                <small>
                  {index + 1}. {order.label}
                  {order.destination ? ` (${order.destination.x}, ${order.destination.y})` : ''}
                </small>
                <button type="button" onClick={() => sendCommand({ type: 'cancel-order', orderId: order.id })}>
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    );
  }

  if (selection?.kind === 'team') {
    return (
      <section className="detail">
        <h3>{snapshot.team.name}</h3>
        <p>Team order. Individual orders still override a member.</p>
        <p>{snapshot.team.memberIds.map((id) => snapshot.entities.find((entity) => entity.id === id)?.name).join(', ')}</p>
      </section>
    );
  }

  if (selection?.kind === 'vehicle') {
    const vehicle = snapshot.vehicles.find((item) => item.id === selection.id);
    if (!vehicle) return null;
    return (
      <section className="detail">
        <h3>{vehicle.name}</h3>
        <p>
          {vehicle.status} · {vehicle.occupants.length}/{vehicle.capacity} seats
        </p>
        {vehicle.pump ? (
          <p>
            Tank {vehicle.pump.tank.toFixed(0)}/{vehicle.pump.tankCapacity} · pump {vehicle.pump.state} ·
            pressure {vehicle.pump.pressure.toFixed(1)}
          </p>
        ) : null}
        <p>{vehicle.contents.map((item) => item.name).join(', ') || 'No stored equipment'}</p>
      </section>
    );
  }

  if (selection?.kind === 'fire') {
    const fire = snapshot.fires.find((item) => item.id === selection.id);
    if (!fire) return null;
    return (
      <section className="detail">
        <h3>{fire.name}</h3>
        <p>{fire.out ? 'Out' : `${Math.round((fire.intensity / fire.maxIntensity) * 100)}% intensity`}</p>
      </section>
    );
  }

  if (selection?.kind === 'hydrant') {
    const hydrant = snapshot.hydrants.find((item) => item.id === selection.id);
    if (!hydrant) return null;
    return (
      <section className="detail">
        <h3>{hydrant.name}</h3>
        <p>{hydrant.connectionId ? 'Connected' : 'Available'} · flow {hydrant.flowCapacity}</p>
      </section>
    );
  }

  if (selection?.kind === 'hose') {
    const hose = snapshot.hoses.find((item) => item.id === selection.id);
    if (!hose) return null;
    return (
      <section className="detail">
        <h3>{hose.name}</h3>
        <p>
          {hose.kind} · {hose.state} · {hose.length.toFixed(1)}/{hose.maxLength} · flow {hose.flow.toFixed(1)}
        </p>
      </section>
    );
  }

  if (selection?.kind === 'object') {
    const object = snapshot.objects.find((item) => item.id === selection.id);
    if (!object) return null;
    return (
      <section className="detail">
        <h3>{object.name}</h3>
        <p>
          {object.objectType} · {object.state}
        </p>
      </section>
    );
  }

  return <p className="help">Select a unit on the map or from the roster.</p>;
}

function StatusMark({ tone }: { tone: string }) {
  return (
    <span className="status" data-tone={tone}>
      <i />
    </span>
  );
}

function focusVehicle(id: string): void {
  useGameStore.getState().selectVehicle(id);
  useGameStore.getState().requestCamera('focus');
}

function cancelSelection(): void {
  const { snapshot, selection } = useGameStore.getState();
  if (!snapshot || !selection) return;
  const ids =
    selection.kind === 'responders'
      ? selection.ids
      : selection.kind === 'team'
        ? snapshot.team.memberIds
        : selection.kind === 'vehicle'
          ? [selection.id]
          : [];
  for (const task of snapshot.tasks) {
    if (!ids.includes(task.assigneeId) || task.parentId) continue;
    if (task.state === 'running' || task.state === 'suspended') {
      sendCommand({ type: 'cancel-task', taskId: task.id });
    }
  }
}

function titleFor(scenarioId: string): string {
  return scenarioId
    .split('-')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

function clock(tick: number, rate: number): string {
  const total = Math.floor(tick / Math.max(rate, 1));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function vehiclePosture(status: string, nodeId: string, stagingId: string | undefined): string {
  if (status === 'idle' && nodeId === stagingId) return 'Staged';
  if (status === 'moving') return 'Responding';
  if (status === 'boarding') return 'Boarding';
  return 'Standing by';
}

function responderPosture(
  snapshot: SimulationSnapshot,
  id: string,
): { label: string; tone: 'ready' | 'working' | 'unavailable' | 'danger' } {
  const entity = snapshot.entities.find((candidate) => candidate.id === id);
  if (!entity) return { label: 'Missing', tone: 'unavailable' };
  if (entity.aboardVehicleId) return { label: 'Aboard', tone: 'unavailable' };
  const tasks = snapshot.tasks.filter((task) => task.assigneeId === id);
  const working = tasks.some(
    (task) => (task.state === 'running' || task.state === 'suspended') && task.kind !== 'interact',
  );
  const failed = tasks.some((task) => task.state === 'failed' && !task.parentId);
  const exposed = snapshot.fires.some(
    (fire) =>
      !fire.out &&
      Math.abs(fire.position.x - Math.floor(entity.position.x)) +
        Math.abs(fire.position.y - Math.floor(entity.position.y)) <=
        2,
  );
  if (exposed) return { label: 'Exposed', tone: 'danger' };
  if (failed && !working) return { label: 'Blocked', tone: 'danger' };
  if (working) return { label: 'Working', tone: 'working' };
  return { label: 'Available', tone: 'ready' };
}

function assignment(snapshot: SimulationSnapshot, id: string): string {
  const task = snapshot.tasks.find(
    (candidate) =>
      candidate.assigneeId === id &&
      candidate.kind !== 'interact' &&
      (candidate.state === 'running' || candidate.state === 'suspended'),
  );
  if (!task) {
    const queued = snapshot.orders.filter((order) => order.assigneeId === id).length;
    return queued > 0 ? `${queued} queued` : '';
  }
  return describeTask(task);
}

function progressFor(
  snapshot: SimulationSnapshot,
  id: string,
): { label: string; percent: number } | null {
  const task = snapshot.tasks.find(
    (candidate) =>
      candidate.assigneeId === id &&
      candidate.state === 'running' &&
      candidate.kind !== 'move' &&
      candidate.kind !== 'interact' &&
      candidate.durationTicks > 0,
  );
  if (!task || task.kind === 'move' || task.kind === 'interact') return null;
  return {
    label: task.kind,
    percent: Math.max(0, Math.min(100, Math.round((task.progressTicks / task.durationTicks) * 100))),
  };
}

function nameOf(snapshot: SimulationSnapshot, id: string): string {
  return snapshot.vehicles.find((vehicle) => vehicle.id === id)?.name ?? id;
}

function describeTask(task: TaskSnapshot): string {
  if (task.kind === 'move') return task.source === 'team' ? 'Team move' : 'Moving';
  if (task.kind === 'board-vehicle') return 'Boarding';
  if (task.kind === 'exit-vehicle') return 'Exiting';
  if (task.kind === 'retrieve-equipment') return 'Retrieving';
  if (task.kind === 'start-pump') return 'Starting pump';
  if (task.kind === 'deploy-attack') return 'Deploying hose';
  if (task.kind === 'connect-supply') return 'Connecting supply';
  if (task.kind === 'operate-nozzle' || task.kind === 'suppress-fire') return 'Suppressing';
  if (task.kind === 'establish-fire-attack') return 'Fire attack';
  if (task.kind === 'respond' || task.kind === 'drive-vehicle') return 'Responding';
  if (task.kind === 'search-room') return 'Searching room';
  if (task.kind === 'search-building') return 'Searching building';
  if (task.kind === 'open-door') return 'Opening door';
  if (task.kind === 'close-door') return 'Closing door';
  if (task.kind === 'force-door') return 'Forcing door';
  return task.kind;
}
