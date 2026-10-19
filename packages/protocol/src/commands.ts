import { z } from 'zod';

import { tileSchema } from './scenario.ts';

export const commandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('pause'),
  }),
  z.object({
    type: z.literal('resume'),
  }),
  z.object({
    type: z.literal('move-responder'),
    responderId: z.string().min(1),
    destination: tileSchema,
  }),
  z.object({
    type: z.literal('move-team'),
    teamId: z.string().min(1),
    destination: tileSchema,
  }),
  z.object({
    type: z.literal('retrieve-equipment'),
    responderId: z.string().min(1),
    lockerId: z.string().min(1),
    definitionId: z.string().min(1),
  }),
  z.object({
    type: z.literal('force-door'),
    responderId: z.string().min(1),
    doorId: z.string().min(1),
  }),
  z.object({
    type: z.literal('operate-panel'),
    responderId: z.string().min(1),
    panelId: z.string().min(1),
  }),
  z.object({
    type: z.literal('retrieve-team'),
    teamId: z.string().min(1),
    lockerId: z.string().min(1),
  }),
  z.object({
    type: z.literal('cancel-task'),
    taskId: z.string().min(1),
  }),
]);

export type Command = z.infer<typeof commandSchema>;
