# Tasks and command

Task kinds are `move` (move-to), `interact`, `retrieve-equipment`, `force-door`, `operate-panel`, `board-vehicle`, `exit-vehicle`, `drive-vehicle`, `respond`, `suppress-fire`, `suppress-incident`, `connect-supply`, `disconnect-supply`, `open-supply`, `close-supply`, `start-pump`, `stop-pump`, `deploy-attack`, `operate-nozzle`, `reposition-nozzle`, `disconnect-attack`, and `establish-fire-attack`. Sources are `team` and `individual`. States are `pending`, `ready`, `running`, `suspended`, `completed`, `failed`, and `cancelled`. A new reachable task passes through `pending`, `ready`, and `running` before the command returns. Terminal states do not change.

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
- `connect-supply`, `open-supply`, `close-supply`, and `disconnect-supply` for a hydrant line
- `start-pump` and `stop-pump` for the engine pump
- `deploy-attack`, `operate-nozzle`, `reposition-nozzle`, and `disconnect-attack` for an attack line
- `establish-fire-attack` for the crew and one incident
- `move-group` for an explicit set of responders, without creating a team
- `enqueue` and `cancel-order` for a waiting individual order

## Water

A supply connection checks hose length along the walking route, not the straight-line distance. The hose remains in the world after the firefighter finishes connecting it. Opening the valve is a separate task. The pump starts only while the engine is parked, then keeps running without a firefighter at the panel. Driving makes the pump unavailable until it is started again.

`operate-nozzle` may lay an unpressurized line and stand in range before water is available. A tick with no flow leaves intensity unchanged. A tick with flow reduces intensity by the attack hose's suppression rate times the flow taken from the tank. The nozzle operator cannot move farther than the deployed route allows.

`establish-fire-attack` confirms the engine is parked, chooses a hydrant the supply hose can reach, and assigns supply, pump, and attack work to free members. A nozzle can be deployed before the pump is running. Water is applied only after the pump is operating and the tank or an open hydrant can supply it. An individual order cancels that firefighter's individual task, or suspends their team task. Reassigning a suspended role cancels that role's assignment and leaves the rest of the objective running. Cancelling the objective still cancels its children.

## Group selection

`move-group` takes responder ids and one destination. Each responder who can path receives an individual move on a distinct nearby tile. The command does not create a team. A responder who cannot path is reported on that move, and the others still go. A later individual order uses the existing override rules.

## Queued orders

`enqueue` stores a move, retrieval, door, panel, board, or exit command on that responder. It does not reserve equipment or interrupt the running task. When the responder has no running task, the next queued command is checked again and then started. An invalid command is dropped and recorded once. A new direct order for that responder clears the queue. `cancel-order` removes one waiting command. The queue is part of the save.

## Buildings and search

A building is a record with one floor, rooms, walls, and an entrance door. Doors stay interactable entities. `open-door` and `close-door` use the task system and reserve the door. `force-door` still requires a Halligan and leaves the door forced, which can be walked through and cannot be closed. A door change replans pedestrian paths. `enter-building` moves a responder to the interior entry tile when the entrance is passable.

`search-room` walks to each listed search tile and spends simulation time there, then marks the room searched and reports discoveries. `search-building` assigns reachable unsearched rooms to free on-foot members who do not already have an individual order. When a closed or locked door is what blocks those rooms, a free member opens it, or forces it when a Halligan tool can be carried or fetched. It does not start a second search of a room that is already assigned. An individual override suspends that member's room task; the building search drops that assignment and gives the room to someone else. Rooms that stay unreachable after that are marked blocked. Clicking search again retries rooms that were blocked. The objective completes when every room is searched or blocked.

## What this model is not yet

There is no goal, plan, or atomic-action library. The vehicle does not steer, accelerate, or change lanes. It travels node to node. The simulation does not replace a missing driver automatically. Fire does not spread to neighboring tiles. Hoses follow tile routes and do not collide with the map.
