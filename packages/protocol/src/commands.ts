import { z } from 'zod';

import { tileSchema } from './scenario.ts';

const moveResponderCommand = z.object({
  type: z.literal('move-responder'),
  responderId: z.string().min(1),
  destination: tileSchema,
});

const retrieveEquipmentCommand = z.object({
  type: z.literal('retrieve-equipment'),
  responderId: z.string().min(1),
  lockerId: z.string().min(1),
  definitionId: z.string().min(1),
});

const forceDoorCommand = z.object({
  type: z.literal('force-door'),
  responderId: z.string().min(1),
  doorId: z.string().min(1),
});

const operatePanelCommand = z.object({
  type: z.literal('operate-panel'),
  responderId: z.string().min(1),
  panelId: z.string().min(1),
});

const boardVehicleCommand = z.object({
  type: z.literal('board-vehicle'),
  responderId: z.string().min(1),
  vehicleId: z.string().min(1),
});

const exitVehicleCommand = z.object({
  type: z.literal('exit-vehicle'),
  responderId: z.string().min(1),
  vehicleId: z.string().min(1),
});

/** Orders that wait until the responder is free and do not reserve equipment early. */
export const queuedCommandSchema = z.discriminatedUnion('type', [
  moveResponderCommand,
  retrieveEquipmentCommand,
  forceDoorCommand,
  operatePanelCommand,
  boardVehicleCommand,
  exitVehicleCommand,
]);

export type QueuedCommand = z.infer<typeof queuedCommandSchema>;

export const commandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('pause'),
  }),
  z.object({
    type: z.literal('resume'),
  }),
  moveResponderCommand,
  z.object({
    type: z.literal('move-team'),
    teamId: z.string().min(1),
    destination: tileSchema,
  }),
  retrieveEquipmentCommand,
  forceDoorCommand,
  operatePanelCommand,
  z.object({
    type: z.literal('retrieve-team'),
    teamId: z.string().min(1),
    lockerId: z.string().min(1),
  }),
  z.object({
    type: z.literal('cancel-task'),
    taskId: z.string().min(1),
  }),
  boardVehicleCommand,
  exitVehicleCommand,
  z.object({
    type: z.literal('board-team'),
    teamId: z.string().min(1),
    vehicleId: z.string().min(1),
  }),
  z.object({
    type: z.literal('disembark-team'),
    teamId: z.string().min(1),
    vehicleId: z.string().min(1),
  }),
  z.object({
    type: z.literal('drive-vehicle'),
    vehicleId: z.string().min(1),
    destinationNodeId: z.string().min(1),
  }),
  z.object({
    type: z.literal('respond-to'),
    teamId: z.string().min(1),
    destinationNodeId: z.string().min(1),
    disembark: z.boolean(),
  }),
  z.object({
    type: z.literal('suppress-fire'),
    responderId: z.string().min(1),
    fireId: z.string().min(1),
  }),
  z.object({
    type: z.literal('suppress-incident'),
    teamId: z.string().min(1),
    incidentId: z.string().min(1),
  }),
  z.object({
    type: z.literal('connect-supply'),
    responderId: z.string().min(1),
    hydrantId: z.string().min(1),
    vehicleId: z.string().min(1),
  }),
  z.object({
    type: z.literal('disconnect-supply'),
    responderId: z.string().min(1),
    hoseId: z.string().min(1),
  }),
  z.object({
    type: z.literal('open-supply'),
    responderId: z.string().min(1),
    hoseId: z.string().min(1),
  }),
  z.object({
    type: z.literal('close-supply'),
    responderId: z.string().min(1),
    hoseId: z.string().min(1),
  }),
  z.object({
    type: z.literal('start-pump'),
    responderId: z.string().min(1),
    vehicleId: z.string().min(1),
  }),
  z.object({
    type: z.literal('stop-pump'),
    responderId: z.string().min(1),
    vehicleId: z.string().min(1),
  }),
  z.object({
    type: z.literal('deploy-attack'),
    responderId: z.string().min(1),
    vehicleId: z.string().min(1),
  }),
  z.object({
    type: z.literal('operate-nozzle'),
    responderId: z.string().min(1),
    hoseId: z.string().min(1),
    fireId: z.string().min(1),
  }),
  z.object({
    type: z.literal('reposition-nozzle'),
    responderId: z.string().min(1),
    hoseId: z.string().min(1),
    destination: tileSchema,
  }),
  z.object({
    type: z.literal('disconnect-attack'),
    responderId: z.string().min(1),
    hoseId: z.string().min(1),
  }),
  z.object({
    type: z.literal('establish-fire-attack'),
    teamId: z.string().min(1),
    incidentId: z.string().min(1),
  }),
  z.object({
    type: z.literal('move-group'),
    responderIds: z.array(z.string().min(1)).min(1),
    destination: tileSchema,
  }),
  z.object({
    type: z.literal('enqueue'),
    order: queuedCommandSchema,
  }),
  z.object({
    type: z.literal('cancel-order'),
    orderId: z.string().min(1),
  }),
  z.object({
    type: z.literal('open-door'),
    responderId: z.string().min(1),
    doorId: z.string().min(1),
  }),
  z.object({
    type: z.literal('close-door'),
    responderId: z.string().min(1),
    doorId: z.string().min(1),
  }),
  z.object({
    type: z.literal('enter-building'),
    responderId: z.string().min(1),
    buildingId: z.string().min(1),
  }),
  z.object({
    type: z.literal('search-room'),
    responderId: z.string().min(1),
    roomId: z.string().min(1),
  }),
  z.object({
    type: z.literal('search-building'),
    teamId: z.string().min(1),
    buildingId: z.string().min(1),
  }),
  z.object({
    type: z.literal('ventilate'),
    responderId: z.string().min(1),
    openingId: z.string().min(1),
  }),
  z.object({
    type: z.literal('overhaul-room'),
    responderId: z.string().min(1),
    roomId: z.string().min(1),
  }),
  z.object({
    type: z.literal('respond-to-incident'),
    teamId: z.string().min(1),
    incidentId: z.string().min(1),
  }),
  z.object({
    type: z.literal('stage-apparatus'),
    teamId: z.string().min(1),
  }),
  z.object({
    type: z.literal('suppress-structure-fire'),
    teamId: z.string().min(1),
    incidentId: z.string().min(1),
  }),
  z.object({
    type: z.literal('search-structure'),
    teamId: z.string().min(1),
    buildingId: z.string().min(1),
  }),
  z.object({
    type: z.literal('defend-exposure'),
    teamId: z.string().min(1),
    incidentId: z.string().min(1),
  }),
  z.object({
    type: z.literal('withdraw-team'),
    teamId: z.string().min(1),
  }),
  z.object({
    type: z.literal('return-to-staging'),
    teamId: z.string().min(1),
  }),
  z.object({
    type: z.literal('set-strategy'),
    incidentId: z.string().min(1),
    strategy: z.enum(['offensive', 'defensive', 'hold', 'rescue', 'containment']),
  }),
  z.object({
    type: z.literal('assign-company'),
    incidentId: z.string().min(1),
  }),
  z.object({
    type: z.literal('set-autonomy'),
    autonomy: z.enum(['standard', 'supervised', 'manual']),
  }),
  z.object({
    type: z.literal('control-fire'),
    incidentId: z.string().min(1),
  }),
  z.object({
    type: z.literal('return-to-service'),
    teamId: z.string().min(1),
  }),
  z.object({
    type: z.literal('approve-decision'),
  }),
  z.object({
    type: z.literal('cancel-objective'),
  }),
  z.object({
    type: z.literal('detach-responder'),
    responderId: z.string().min(1),
  }),
  z.object({
    type: z.literal('rejoin-team'),
    responderId: z.string().min(1),
  }),
  z.object({
    type: z.literal('place-zone'),
    incidentId: z.string().min(1),
    kind: z.enum(['staging', 'assembly', 'search', 'attack', 'exclusion', 'withdrawal']),
    position: tileSchema,
  }),
]);

export type Command = z.infer<typeof commandSchema>;
