# Tasks and command

Task kinds are `move` (move-to), `interact`, `retrieve-equipment`, `force-door`, and `operate-panel`. Sources are `team` and `individual`. States are `pending`, `ready`, `running`, `suspended`, `completed`, `failed`, and `cancelled`. A new reachable task passes through `pending`, `ready`, and `running` before the command returns. Terminal states do not change.

Compound tasks keep the script in the simulation. `force-door` checks the door, retrieves a Halligan tool when the responder does not have one, moves to an interaction tile, then spends interaction ticks. `retrieve-equipment` and `operate-panel` move to an interaction tile and then spend interaction ticks. Those ticks advance only inside `tick()`.

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

When the override completes, the suspended team task is revalidated. A move is replanned from the responder's current tile when the original destination is still reachable. A retrieval resumes only if its reserved item is still held for that task and the responder still has a free inventory slot. A changed door, a missing tool, or a full inventory fails the suspended task. The simulation does not create a replacement. The rest of the team never lost their order.

Equipment instances are exclusive. A task reserves an instance when it starts and releases that reservation when it completes, fails, or is cancelled. Taking the item moves it from the locker into the responder's inventory, up to the scenario's slot capacity.

## Pause

Pause stops ticks. It does not stop commands. A move issued while paused becomes a running task immediately and starts advancing on resume.

## What this model is not yet

There is no goal, plan, or atomic-action library. Fire suppression and other incident actions should be new task kinds that reuse the same states, group ids, suspension, and resource checks. Equipment reservation is not implemented; the staging-tile set is the only exclusive resource, and it only prevents two members of one order from being given the same tile.
