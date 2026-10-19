# Tasks and command

Task kinds are `move` (move-to), `interact`, `retrieve-equipment`, `force-door`, `operate-panel`, `board-vehicle`, `exit-vehicle`, `drive-vehicle`, `respond`, `suppress-fire`, and `suppress-incident`. Sources are `team` and `individual`. States are `pending`, `ready`, `running`, `suspended`, `completed`, `failed`, and `cancelled`. A new reachable task passes through `pending`, `ready`, and `running` before the command returns. Terminal states do not change.

Compound tasks keep the script in the simulation. `force-door` checks the door, retrieves a Halligan tool when the responder does not have one, moves to an interaction tile, then spends interaction ticks. `retrieve-equipment` and `operate-panel` move to an interaction tile and then spend interaction ticks. `board-vehicle` reserves a seat, walks to the vehicle, and spends interaction ticks before the responder becomes an occupant. `exit-vehicle` requires a parked vehicle, reserves an adjacent tile, and spends interaction ticks before the responder is placed there. `respond` boards eligible crew, drives only after the designated driver is aboard, then disembarks when requested. Those ticks advance only inside `tick()`.

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

An individual move issued while a responder is boarding suspends that boarding task and releases the seat. The transport order does not wait for a suspended member. If the designated driver is not aboard when the other boarding tasks finish, the transport fails with `No available driver`. Cancelling a board, drive, or response releases the seat, exit tile, or parking node. Occupants who already boarded stay aboard.

Equipment instances are exclusive. A task reserves an instance when it starts and releases that reservation when it completes, fails, or is cancelled. Taking the item moves it from a locker or a parked vehicle into the responder's inventory, up to the scenario's slot capacity. A moving vehicle cannot be looted. Seats, exit tiles, and destination nodes use the same release-on-cancel rule.

## Pause

Pause stops ticks. It does not stop commands. A move, boarding interaction, vehicle order, or suppression order issued while paused becomes a running task immediately and starts advancing on resume. Vehicle position, boarding progress, fire intensity, fuel, and suppression progress stay where they were.

A save copies those tasks as they are, including a suspended override and any seat, exit, node, or equipment reservation. Loading that save continues the same tasks. It does not reserve the equipment again or restart the interaction.

## Fire suppression

`suppress-fire` is an individual order against one fire. The responder must be on foot, the fire must still be burning, and a reachable tile must be within the fire's range. The task uses an item whose catalog capability is `suppress`, whose suppression rate is above zero, and whose remaining agent is above zero. If the responder is already carrying one, they walk into range and apply it. Otherwise the task reserves the nearest stored item, in a locker or on a parked vehicle, and retrieves it first.

Each suppression tick consumes one agent and reduces intensity by the catalog rate. Growth has already been applied earlier in the same tick. The task completes when intensity reaches zero, including the tick that spends the last agent to finish the fire. If agent reaches zero while intensity is still above zero, the task fails and the incident stays active. Cancelling or failing the task releases the reservation.

`suppress-incident` is a team order. It creates one parent task for the incident and one `suppress-fire` child for each member who can reach the fire and take a distinct item. Members who are aboard, boarding, exiting, or already on an individual order are left alone. An individual move suspends that member's child and leaves the parent running. If the suspended member had reserved an item they do not yet carry, the parent releases that reservation and assigns another free member. The parent completes when every objective on the incident is satisfied, and that completion cancels any suspended children. The individual move is not one of those children, so the override remains.

## Commands added for vehicles

- `board-vehicle` and `exit-vehicle` for one responder
- `board-team` and `disembark-team` for the crew
- `drive-vehicle` to a road node, which requires the designated driver aboard
- `respond-to` boards eligible members, drives, and optionally disembarks
- `suppress-fire` for one responder and one fire
- `suppress-incident` for the crew and one incident

## What this model is not yet

There is no goal, plan, or atomic-action library. The vehicle does not steer, accelerate, or change lanes. It travels node to node. The simulation does not replace a missing driver automatically. Fire does not spread to neighboring tiles, and suppression does not use pumps, hoses, or hydrants.
