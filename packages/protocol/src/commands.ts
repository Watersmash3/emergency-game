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
]);

export type Command = z.infer<typeof commandSchema>;
