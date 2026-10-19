import { z } from 'zod';

import { commandSchema } from './commands.ts';
import { scenarioSchema } from './scenario.ts';
import { simulationSnapshotSchema } from './snapshot.ts';

export const workerInboundSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('init'),
    scenario: scenarioSchema,
  }),
  z.object({
    type: z.literal('command'),
    commandId: z.string().min(1),
    command: commandSchema,
  }),
]);

export type WorkerInbound = z.infer<typeof workerInboundSchema>;

export const workerOutboundSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
  }),
  z.object({
    type: z.literal('snapshot'),
    snapshot: simulationSnapshotSchema,
  }),
  z.object({
    type: z.literal('command-result'),
    commandId: z.string().min(1),
    ok: z.boolean(),
    reason: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string().min(1),
  }),
]);

export type WorkerOutbound = z.infer<typeof workerOutboundSchema>;
