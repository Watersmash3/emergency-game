# Tasks and command

The foundation has one task kind, `move`, and two sources, `team` and `individual`. States are `pending`, `ready`, `running`, `suspended`, `completed`, `failed`, and `cancelled`. A new reachable move passes through `pending`, `ready`, and `running` before the command returns. Terminal states do not change.

## Team move

`move-team` cancels each member's open tasks, then creates one move per member under a shared `groupId`. Members who can path receive a `running` task on a distinct staging tile. A member who cannot path receives a `failed` task and a reason. The other members still go.

## Individual override

`move-responder` is rejected, without changing tasks, when the responder is unknown or the tile is out of bounds, blocked, or unreachable.

When it is accepted:

1. An existing individual move for that responder is cancelled.
2. The new individual move becomes the running task.
3. That responder's team move, if running, becomes `suspended` and records the override id.
4. A second override updates that pointer and leaves the team move suspended.
5. Every other member's task is left alone.

When the override completes, the suspended team move returns to `running` and is replanned from the responder's current tile. The rest of the team never lost their order.

## Pause

Pause stops ticks. It does not stop commands. A move issued while paused becomes a running task immediately and starts advancing on resume.

## What this model is not yet

There is no goal, plan, or atomic-action library. Fire suppression and other incident actions should be new task kinds that reuse the same states, group ids, suspension, and resource checks. Equipment reservation is not implemented; the staging-tile set is the only exclusive resource, and it only prevents two members of one order from being given the same tile.
