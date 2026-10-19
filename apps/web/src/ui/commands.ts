import type { Command, SimulationSnapshot } from '@emergency/protocol';

import type { Selection } from '../game/input/selection.ts';

export type CommandGroup = 'movement' | 'team' | 'equipment' | 'apparatus' | 'incident';

export interface CommandAction {
  id: string;
  label: string;
  group: CommandGroup;
  enabled: boolean;
  title: string;
  commands: Command[];
}

export function commandActions(snapshot: SimulationSnapshot, selection: Selection): CommandAction[] {
  if (selection?.kind === 'responders') return responderActions(snapshot, selection.ids);
  if (selection?.kind === 'team') return teamActions(snapshot, selection.id);
  if (selection?.kind === 'vehicle') return vehicleActions(snapshot, selection.id);
  return [];
}

function responderActions(snapshot: SimulationSnapshot, ids: string[]): CommandAction[] {
  const members = ids
    .map((id) => snapshot.entities.find((entity) => entity.id === id))
    .filter((entity) => entity !== undefined);
  const actions: CommandAction[] = [];
  const onFoot = members.filter((entity) => !entity.aboardVehicleId);
  actions.push({
    id: 'move',
    label: 'Move',
    group: 'movement',
    enabled: onFoot.length > 0,
    title: 'Right-click the ground. Hold Shift to queue one responder.',
    commands: [],
  });

  const one = members.length === 1 ? members[0] : undefined;
  const apparatus = snapshot.vehicles.find((vehicle) => vehicle.id === snapshot.team.apparatusId);
  if (one && apparatus) {
    const aboard = one.aboardVehicleId === apparatus.id;
    actions.push({
      id: 'board',
      label: 'Board',
      group: 'team',
      enabled: !one.aboardVehicleId,
      title: 'Board the apparatus',
      commands: [
        { type: 'board-vehicle', responderId: one.id, vehicleId: apparatus.id },
      ],
    });
    actions.push({
      id: 'exit',
      label: 'Exit',
      group: 'team',
      enabled: aboard,
      title: 'Leave the apparatus',
      commands: [{ type: 'exit-vehicle', responderId: one.id, vehicleId: apparatus.id }],
    });
    if (!one.aboardVehicleId && apparatus.pump) {
      actions.push(
        {
          id: 'start-pump',
          label: 'Operate pump',
          group: 'apparatus',
          enabled: true,
          title: 'Start the pump',
          commands: [{ type: 'start-pump', responderId: one.id, vehicleId: apparatus.id }],
        },
        {
          id: 'stop-pump',
          label: 'Stop pump',
          group: 'apparatus',
          enabled: apparatus.pump.state !== 'off',
          title: 'Shut the pump down',
          commands: [{ type: 'stop-pump', responderId: one.id, vehicleId: apparatus.id }],
        },
        {
          id: 'deploy-attack',
          label: 'Deploy hose',
          group: 'equipment',
          enabled: true,
          title: 'Pull an attack line',
          commands: [{ type: 'deploy-attack', responderId: one.id, vehicleId: apparatus.id }],
        },
      );
      for (const hydrant of snapshot.hydrants) {
        actions.push({
          id: `supply-${hydrant.id}`,
          label: 'Connect supply',
          group: 'apparatus',
          enabled: hydrant.connectionId === null,
          title: `Connect a supply line to ${hydrant.name}`,
          commands: [
            {
              type: 'connect-supply',
              responderId: one.id,
              hydrantId: hydrant.id,
              vehicleId: apparatus.id,
            },
          ],
        });
      }
      for (const item of apparatus.contents.filter((content) => !content.reserved)) {
        actions.push({
          id: `retrieve-${item.id}`,
          label: `Retrieve ${item.name}`,
          group: 'equipment',
          enabled: true,
          title: 'Hold Shift while using the locker to queue retrieval',
          commands: [
            {
              type: 'retrieve-equipment',
              responderId: one.id,
              lockerId: apparatus.id,
              definitionId: item.definitionId,
            },
          ],
        });
      }
    }
    for (const hose of snapshot.hoses) {
      if (hose.kind === 'supply') {
        actions.push(
          {
            id: `open-${hose.id}`,
            label: 'Open supply',
            group: 'apparatus',
            enabled: hose.state !== 'open',
            title: hose.name,
            commands: [{ type: 'open-supply', responderId: one.id, hoseId: hose.id }],
          },
          {
            id: `close-${hose.id}`,
            label: 'Close supply',
            group: 'apparatus',
            enabled: hose.state === 'open',
            title: hose.name,
            commands: [{ type: 'close-supply', responderId: one.id, hoseId: hose.id }],
          },
          {
            id: `drop-${hose.id}`,
            label: 'Disconnect supply',
            group: 'apparatus',
            enabled: true,
            title: hose.name,
            commands: [{ type: 'disconnect-supply', responderId: one.id, hoseId: hose.id }],
          },
        );
      } else if (hose.operatorId === one.id) {
        for (const fire of snapshot.fires.filter((candidate) => !candidate.out)) {
          actions.push({
            id: `nozzle-${hose.id}-${fire.id}`,
            label: 'Suppress',
            group: 'incident',
            enabled: true,
            title: `Open ${hose.name} on ${fire.name}`,
            commands: [
              { type: 'operate-nozzle', responderId: one.id, hoseId: hose.id, fireId: fire.id },
            ],
          });
        }
        actions.push({
          id: `stow-${hose.id}`,
          label: 'Disconnect hose',
          group: 'equipment',
          enabled: true,
          title: hose.name,
          commands: [{ type: 'disconnect-attack', responderId: one.id, hoseId: hose.id }],
        });
      }
    }
    if (!snapshot.hoses.some((hose) => hose.operatorId === one.id)) {
      for (const fire of snapshot.fires.filter((candidate) => !candidate.out)) {
        actions.push({
          id: `suppress-${fire.id}`,
          label: 'Suppress',
          group: 'incident',
          enabled: !one.aboardVehicleId,
          title: fire.name,
          commands: [{ type: 'suppress-fire', responderId: one.id, fireId: fire.id }],
        });
      }
    }
  }

  for (const object of snapshot.objects) {
    const command = objectCommand(snapshot, ids, object.id);
    if (!command) continue;
    actions.push({
      id: `object-${object.id}`,
      label: objectLabel(object.objectType, object.name),
      group: object.objectType === 'locker' ? 'equipment' : 'incident',
      enabled: true,
      title: 'Hold Shift to queue this interaction',
      commands: [command],
    });
  }

  pushCancel(actions, snapshot, ids);
  pushClear(actions, snapshot, ids);
  return dedupe(actions);
}

function teamActions(snapshot: SimulationSnapshot, teamId: string): CommandAction[] {
  const apparatus = snapshot.vehicles.find((vehicle) => vehicle.id === snapshot.team.apparatusId);
  const staging = snapshot.roads.find((road) => road.kind === 'staging');
  const actions: CommandAction[] = [
    {
      id: 'move',
      label: 'Move',
      group: 'movement',
      enabled: true,
      title: 'Right-click the ground to move the crew',
      commands: [],
    },
  ];
  if (apparatus) {
    actions.push(
      {
        id: 'board',
        label: 'Board',
        group: 'team',
        enabled: true,
        title: 'Board the crew',
        commands: [{ type: 'board-team', teamId, vehicleId: apparatus.id }],
      },
      {
        id: 'exit',
        label: 'Disembark',
        group: 'team',
        enabled: apparatus.occupants.length > 0,
        title: 'Disembark the crew',
        commands: [{ type: 'disembark-team', teamId, vehicleId: apparatus.id }],
      },
    );
    if (staging) {
      actions.push({
        id: 'respond',
        label: 'Respond',
        group: 'team',
        enabled: true,
        title: 'Respond to staging and disembark',
        commands: [
          { type: 'respond-to', teamId, destinationNodeId: staging.id, disembark: true },
        ],
      });
    }
  }
  for (const incident of snapshot.incidents.filter((candidate) => candidate.state === 'active')) {
    if (apparatus?.pump) {
      actions.push({
        id: `attack-${incident.id}`,
        label: 'Deploy hose',
        group: 'equipment',
        enabled: true,
        title: `Establish a fire attack on ${incident.name}`,
        commands: [{ type: 'establish-fire-attack', teamId, incidentId: incident.id }],
      });
    }
    actions.push({
      id: `suppress-${incident.id}`,
      label: 'Suppress',
      group: 'incident',
      enabled: true,
      title: incident.name,
      commands: [{ type: 'suppress-incident', teamId, incidentId: incident.id }],
    });
  }
  const locker = snapshot.objects.find((object) => object.objectType === 'locker');
  if (locker) {
    actions.push({
      id: 'retrieve-team',
      label: 'Retrieve equipment',
      group: 'equipment',
      enabled: true,
      title: locker.name,
      commands: [{ type: 'retrieve-team', teamId, lockerId: locker.id }],
    });
  }
  pushCancel(actions, snapshot, snapshot.team.memberIds);
  return actions;
}

function vehicleActions(snapshot: SimulationSnapshot, vehicleId: string): CommandAction[] {
  const vehicle = snapshot.vehicles.find((candidate) => candidate.id === vehicleId);
  const staging = snapshot.roads.find((road) => road.kind === 'staging');
  const actions: CommandAction[] = [];
  if (vehicle && staging) {
    actions.push({
      id: 'drive',
      label: 'Respond',
      group: 'team',
      enabled: vehicle.status !== 'moving',
      title: 'Drive to staging',
      commands: [{ type: 'drive-vehicle', vehicleId, destinationNodeId: staging.id }],
    });
  }
  if (vehicle) {
    actions.push({
      id: 'exit',
      label: 'Disembark',
      group: 'team',
      enabled: vehicle.occupants.length > 0,
      title: 'Disembark the crew',
      commands: [{ type: 'disembark-team', teamId: snapshot.team.id, vehicleId }],
    });
  }
  pushCancel(actions, snapshot, [vehicleId]);
  return actions;
}

function objectCommand(
  snapshot: SimulationSnapshot,
  ids: string[],
  objectId: string,
): Command | null {
  const responderId = ids.length === 1 ? ids[0] : undefined;
  if (!responderId) return null;
  const object = snapshot.objects.find((candidate) => candidate.id === objectId);
  if (!object) return null;
  if (object.objectType === 'locker') {
    const item = object.contents.find((content) => !content.reserved) ?? object.contents[0];
    if (!item) return null;
    return {
      type: 'retrieve-equipment',
      responderId,
      lockerId: object.id,
      definitionId: item.definitionId,
    };
  }
  if (object.objectType === 'door') {
    return object.state === 'open'
      ? null
      : { type: 'force-door', responderId, doorId: object.id };
  }
  if (object.objectType === 'panel') {
    return object.state === 'operated'
      ? null
      : { type: 'operate-panel', responderId, panelId: object.id };
  }
  return null;
}

function objectLabel(objectType: string, name: string): string {
  if (objectType === 'door') return 'Force door';
  if (objectType === 'panel') return 'Operate panel';
  return name;
}

function pushCancel(actions: CommandAction[], snapshot: SimulationSnapshot, ids: string[]): void {
  const open = snapshot.tasks.filter(
    (task) =>
      ids.includes(task.assigneeId) &&
      !task.parentId &&
      (task.state === 'running' || task.state === 'suspended'),
  );
  actions.push({
    id: 'cancel',
    label: 'Cancel',
    group: 'movement',
    enabled: open.length > 0,
    title: 'Backspace cancels the current order',
    commands: open.map((task) => ({ type: 'cancel-task', taskId: task.id })),
  });
}

function pushClear(actions: CommandAction[], snapshot: SimulationSnapshot, ids: string[]): void {
  const orders = snapshot.orders.filter((order) => ids.includes(order.assigneeId));
  if (orders.length === 0) return;
  actions.push({
    id: 'clear-queue',
    label: 'Clear queue',
    group: 'movement',
    enabled: true,
    title: 'Drop queued orders',
    commands: orders.map((order) => ({ type: 'cancel-order', orderId: order.id })),
  });
}

function dedupe(actions: CommandAction[]): CommandAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    if (seen.has(action.id)) return false;
    seen.add(action.id);
    return true;
  });
}
