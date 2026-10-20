import type { Command, Tile } from '@emergency/protocol';

import {
  defaultPlan,
  type AutonomyPolicy,
  type CommandStrategy,
  type OperationPlan,
  type StrategicOrder,
  type TacticalZone,
} from '../components/command.ts';
import type { World } from '../core/world.ts';
import { tileKey, tileOf } from '../navigation/grid.ts';
import { spacedTiles, workPosition } from '../navigation/routes.ts';
import { fireControlled } from '../systems/hazardQuery.ts';
import { applyBuildingCommand } from './building.ts';
import { abandonTask, cancelTask, isOpen, nextIdentifier, overrideWith } from './lifecycle.ts';
import { noteHazard, noteInfo } from './notices.ts';
import { CommandRejection, type CommandResult } from './results.ts';
import { transition } from './transitions.ts';
import type { MoveTask } from './types.ts';
import { applyVehicleCommand } from './vehicles.ts';
import { blocksPedestrian } from './vehicleRules.ts';
import { applyWaterCommand } from './water.ts';

const STRATEGIES = new Set<CommandStrategy>(['offensive', 'defensive', 'hold', 'rescue', 'containment']);
const AUTONOMY = new Set<AutonomyPolicy>(['standard', 'supervised', 'manual']);

export function applyOperationalCommand(world: World, command: OperationalCommand): CommandResult {
  switch (command.type) {
    case 'respond-to-incident':
      return respondToIncident(world, command.teamId, command.incidentId);
    case 'stage-apparatus':
      return stageApparatus(world, command.teamId);
    case 'suppress-structure-fire':
      return suppressStructure(world, command.teamId, command.incidentId);
    case 'search-structure':
      return searchStructure(world, command.teamId, command.buildingId);
    case 'defend-exposure':
      return defendExposure(world, command.teamId, command.incidentId);
    case 'withdraw-team':
      return withdrawTeam(world, command.teamId);
    case 'return-to-staging':
      return returnToStaging(world, command.teamId);
    case 'set-strategy':
      return setStrategy(world, command.incidentId, command.strategy);
    case 'detach-responder':
      return detachResponder(world, command.responderId);
    case 'rejoin-team':
      return rejoinTeam(world, command.responderId);
    case 'place-zone':
      return placeZone(world, command.incidentId, command.kind, command.position);
    case 'assign-company':
      return assignCompany(world, command.incidentId);
    case 'set-autonomy':
      return setAutonomy(world, command.autonomy);
    case 'control-fire':
      return controlFire(world, command.incidentId);
    case 'return-to-service':
      return returnToService(world, command.teamId);
    case 'approve-decision':
      return approveDecision(world);
    case 'cancel-objective':
      return cancelObjective(world);
    default: {
      const unreachable: never = command;
      return unreachable;
    }
  }
}

export type OperationalCommand = Extract<
  Command,
  {
    type:
      | 'respond-to-incident'
      | 'stage-apparatus'
      | 'suppress-structure-fire'
      | 'search-structure'
      | 'defend-exposure'
      | 'withdraw-team'
      | 'return-to-staging'
      | 'set-strategy'
      | 'detach-responder'
      | 'rejoin-team'
      | 'place-zone'
      | 'assign-company'
      | 'set-autonomy'
      | 'control-fire'
      | 'return-to-service'
      | 'approve-decision'
      | 'cancel-objective';
  }
>;

/** Advance strategic orders into the existing task system. Completed work is not reissued. */
export function stepOperations(world: World): void {
  for (const plan of world.plans.values()) {
    if (plan.order === 'respond') {
      const controlling = world.strategicOrders.some(
        (order) => order.kind === 'control-fire' && (order.state === 'running' || order.state === 'awaiting'),
      );
      if (!controlling && companyOnScene(world)) {
        plan.phase = 'idle';
        plan.order = 'none';
        plan.blockedReason = null;
      }
      continue;
    }
    if (plan.order === 'attack' && plan.phase === 'blocked') continue;
    if (plan.order !== 'attack') continue;
    const running = attackOpen(world);
    if (running) {
      plan.phase = 'attacking';
      plan.blockedReason = null;
      continue;
    }
    const incident = world.incidents.get(plan.incidentId);
    if (incident?.state === 'resolved') {
      plan.phase = 'complete';
      plan.order = 'none';
    }
  }
  for (const order of world.strategicOrders) {
    if (order.state === 'complete' || order.state === 'cancelled') continue;
    if (order.kind === 'control-fire') advanceControl(world, order);
    else if (order.kind === 'respond') advanceRespond(world, order);
    else if (order.kind === 'withdraw') advanceWithdraw(world, order);
    else if (order.kind === 'return-to-service') advanceReturn(world, order);
  }
}

function respondToIncident(world: World, teamId: string, incidentId: string): CommandResult {
  const plan = ensurePlan(world, incidentId);
  if (!plan) return { ok: false, reason: CommandRejection.UnknownIncident };
  const staging = stagingNode(world);
  if (!staging) return { ok: false, reason: CommandRejection.UnknownNode };
  const result = applyVehicleCommand(world, {
    type: 'respond-to',
    teamId,
    destinationNodeId: staging,
    disembark: true,
  });
  if (!result.ok) {
    plan.phase = 'blocked';
    plan.blockedReason = result.reason ?? CommandRejection.NoPath;
    return result;
  }
  plan.order = 'respond';
  plan.phase = 'responding';
  plan.blockedReason = null;
  noteInfo(world, `plan:${incidentId}:respond`, 'Engine is responding to staging.');
  return { ok: true };
}

function stageApparatus(world: World, teamId: string): CommandResult {
  if (world.team.id !== teamId) return { ok: false, reason: CommandRejection.UnknownTeam };
  const vehicleId = world.team.apparatusId;
  const staging = stagingNode(world);
  if (!vehicleId || !staging) return { ok: false, reason: CommandRejection.NoVehicle };
  return applyVehicleCommand(world, { type: 'drive-vehicle', vehicleId, destinationNodeId: staging });
}

function suppressStructure(world: World, teamId: string, incidentId: string): CommandResult {
  const plan = ensurePlan(world, incidentId);
  if (!plan) return { ok: false, reason: CommandRejection.UnknownIncident };
  plan.strategy = 'offensive';
  const running = [...world.tasks.values()].some(
    (task) => task.kind === 'establish-fire-attack' && isOpen(task.state),
  );
  if (running) {
    plan.order = 'attack';
    plan.phase = 'attacking';
    plan.blockedReason = null;
    return { ok: true };
  }
  const result = applyWaterCommand(world, { type: 'establish-fire-attack', teamId, incidentId });
  plan.order = 'attack';
  if (!result.ok) {
    plan.phase = 'blocked';
    plan.blockedReason = result.reason ?? CommandRejection.NoPath;
    noteHazard(world, `plan:${incidentId}:attack`, result.reason ?? 'Fire attack is blocked.');
    return result;
  }
  plan.phase = 'attacking';
  plan.blockedReason = null;
  noteInfo(world, `plan:${incidentId}:attack`, 'Offensive fire attack ordered.');
  return { ok: true };
}

function searchStructure(world: World, teamId: string, buildingId: string): CommandResult {
  const incidentId = [...world.incidents.keys()][0] ?? '';
  const plan = incidentId ? ensurePlan(world, incidentId) : undefined;
  const result = applyBuildingCommand(world, { type: 'search-building', teamId, buildingId });
  if (plan) {
    plan.order = 'search';
    plan.buildingId = buildingId;
    plan.phase = result.ok ? 'searching' : 'blocked';
    plan.blockedReason = result.ok ? null : (result.reason ?? CommandRejection.NoPath);
  }
  return result;
}

function defendExposure(world: World, teamId: string, incidentId: string): CommandResult {
  const plan = ensurePlan(world, incidentId);
  if (!plan) return { ok: false, reason: CommandRejection.UnknownIncident };
  if (world.team.id !== teamId) return { ok: false, reason: CommandRejection.UnknownTeam };
  plan.strategy = 'defensive';
  plan.order = 'defend';
  const anchor = incidentAnchor(world, incidentId);
  const moved = postCrew(world, anchor, 'assembly');
  plan.phase = moved.ok ? 'defending' : 'blocked';
  plan.blockedReason = moved.ok ? null : (moved.reason ?? CommandRejection.NoPath);
  if (moved.ok) noteInfo(world, `plan:${incidentId}:defend`, 'Defensive exposure cover ordered.');
  return moved;
}

function withdrawTeam(world: World, teamId: string): CommandResult {
  if (world.team.id !== teamId) return { ok: false, reason: CommandRejection.UnknownTeam };
  cancelCrewWork(world);
  const moved = postCrew(world, { x: 0, y: 0 }, 'withdrawal');
  for (const plan of world.plans.values()) {
    plan.order = 'withdraw';
    plan.phase = moved.ok ? 'withdrawing' : 'blocked';
    plan.blockedReason = moved.ok ? null : (moved.reason ?? CommandRejection.NoPath);
  }
  if (moved.ok) noteInfo(world, 'plan:withdraw', 'Crew is withdrawing.');
  for (const existing of world.strategicOrders) {
    if (existing.kind === 'control-fire' && existing.state !== 'complete' && existing.state !== 'cancelled') {
      existing.state = 'cancelled';
      existing.progress = 'Cancelled';
    }
  }
  const order = ensureStrategic(world, 'withdraw', planOf(world)?.incidentId ?? '', world.team.id);
  order.posted = true;
  order.state = moved.ok ? 'running' : 'blocked';
  order.progress = moved.ok ? 'Withdrawing' : 'Withdrawal blocked';
  order.blockedReason = moved.ok ? null : (moved.reason ?? CommandRejection.NoPath);
  return moved;
}

function returnToStaging(world: World, teamId: string): CommandResult {
  if (world.team.id !== teamId) return { ok: false, reason: CommandRejection.UnknownTeam };
  const nodeId = stagingNode(world);
  const node = nodeId ? world.roadNodes.get(nodeId) : undefined;
  if (!node) return { ok: false, reason: CommandRejection.UnknownNode };
  const moved = postCrew(world, { x: node.x, y: node.y }, 'staging');
  for (const plan of world.plans.values()) {
    if (!moved.ok) continue;
    plan.order = 'return';
    plan.phase = 'responding';
    plan.blockedReason = null;
  }
  return moved;
}

function setStrategy(world: World, incidentId: string, strategy: string): CommandResult {
  if (!STRATEGIES.has(strategy as CommandStrategy)) {
    return { ok: false, reason: CommandRejection.Unsupported };
  }
  const plan = ensurePlan(world, incidentId);
  if (!plan) return { ok: false, reason: CommandRejection.UnknownIncident };
  plan.strategy = strategy as CommandStrategy;
  noteInfo(world, `plan:${incidentId}:strategy:${strategy}`, `Strategy set to ${strategy}.`);
  return { ok: true };
}

function detachResponder(world: World, responderId: string): CommandResult {
  const entity = world.entities.get(responderId);
  if (!entity?.responder) return { ok: false, reason: CommandRejection.UnknownResponder };
  world.detached.add(responderId);
  for (const task of [...world.tasks.values()]) {
    if (task.assigneeId !== responderId || task.source !== 'team' || !isOpen(task.state)) continue;
    abandonTask(world, task);
  }
  noteInfo(world, `detach:${responderId}`, `${entity.responder.name} is detached from the crew.`);
  return { ok: true };
}

function rejoinTeam(world: World, responderId: string): CommandResult {
  const entity = world.entities.get(responderId);
  if (!entity?.responder) return { ok: false, reason: CommandRejection.UnknownResponder };
  if ((world.exposure.get(responderId) ?? 0) >= 0.85) {
    return { ok: false, reason: 'Exposure is too high to rejoin' };
  }
  world.detached.delete(responderId);
  noteInfo(world, `rejoin:${responderId}`, `${entity.responder.name} rejoined the crew.`);
  return { ok: true };
}

function placeZone(
  world: World,
  incidentId: string,
  kind: TacticalZone['kind'],
  position: Tile,
): CommandResult {
  if (!world.incidents.has(incidentId)) return { ok: false, reason: CommandRejection.UnknownIncident };
  const zone: TacticalZone = {
    id: nextIdentifier(world, 'zone'),
    incidentId,
    kind,
    x: position.x,
    y: position.y,
  };
  world.zones = world.zones.filter((item) => !(item.incidentId === incidentId && item.kind === kind));
  world.zones.push(zone);
  return { ok: true };
}

function assignCompany(world: World, incidentId: string): CommandResult {
  if (!world.incidents.has(incidentId)) return { ok: false, reason: CommandRejection.UnknownIncident };
  world.assignedIncidentId = incidentId;
  const incident = world.incidents.get(incidentId);
  noteInfo(world, `company:assign:${incidentId}`, `${world.team.name} assigned to ${incident?.name ?? 'the incident'}.`);
  return { ok: true };
}

function setAutonomy(world: World, autonomy: string): CommandResult {
  if (!AUTONOMY.has(autonomy as AutonomyPolicy)) return { ok: false, reason: CommandRejection.Unsupported };
  world.autonomy = autonomy as AutonomyPolicy;
  if (world.autonomy === 'standard') {
    for (const order of world.strategicOrders) {
      if (order.kind === 'control-fire' && order.state === 'awaiting' && order.progress === 'Direct control') {
        order.state = 'running';
        order.progress = 'Resuming';
      }
    }
  }
  noteInfo(world, `company:autonomy:${autonomy}`, `${world.team.name} autonomy set to ${autonomy}.`);
  return { ok: true };
}

function controlFire(world: World, incidentId: string): CommandResult {
  const plan = ensurePlan(world, incidentId);
  if (!plan) return { ok: false, reason: CommandRejection.UnknownIncident };
  if (world.assignedIncidentId !== incidentId) {
    return { ok: false, reason: CommandRejection.CompanyUnassigned };
  }
  const existing = world.strategicOrders.find(
    (order) =>
      order.kind === 'control-fire' &&
      order.incidentId === incidentId &&
      (order.state === 'running' || order.state === 'awaiting' || order.state === 'blocked'),
  );
  if (existing) return { ok: true };
  const order = ensureStrategic(world, 'control-fire', incidentId, world.team.id);
  if (world.autonomy === 'manual') {
    order.state = 'awaiting';
    order.progress = 'Direct control';
    return { ok: true };
  }
  advanceControl(world, order);
  return { ok: true };
}

function returnToService(world: World, teamId: string): CommandResult {
  if (world.team.id !== teamId) return { ok: false, reason: CommandRejection.UnknownTeam };
  for (const order of world.strategicOrders) {
    if (order.kind === 'control-fire' && order.state !== 'complete' && order.state !== 'cancelled') {
      order.state = 'cancelled';
      order.progress = 'Cancelled';
    }
  }
  cancelCrewWork(world);
  const order = ensureStrategic(world, 'return-to-service', planOf(world)?.incidentId ?? '', teamId);
  order.posted = false;
  order.state = 'running';
  order.progress = 'Returning to service';
  advanceReturn(world, order);
  return { ok: true };
}

function approveDecision(world: World): CommandResult {
  const order = world.strategicOrders.find((item) => item.state === 'awaiting' && item.decision);
  if (!order) return { ok: false, reason: CommandRejection.NoDecision };
  order.approved = true;
  order.decision = null;
  order.state = 'running';
  order.progress = 'Approved';
  if (order.kind === 'control-fire') advanceControl(world, order);
  return { ok: true };
}

function cancelObjective(world: World): CommandResult {
  const active = world.strategicOrders.filter(
    (order) => order.state === 'running' || order.state === 'awaiting' || order.state === 'blocked',
  );
  if (active.length === 0) return { ok: true };
  for (const order of active) {
    order.state = 'cancelled';
    order.progress = 'Cancelled';
    order.decision = null;
  }
  cancelCrewWork(world);
  for (const plan of world.plans.values()) {
    if (plan.phase === 'complete') continue;
    plan.order = 'none';
    plan.phase = 'idle';
    plan.blockedReason = null;
  }
  noteInfo(world, 'company:cancel', 'Company objective cancelled.');
  return { ok: true };
}

function advanceControl(world: World, order: StrategicOrder): void {
  const plan = ensurePlan(world, order.incidentId);
  const incident = world.incidents.get(order.incidentId);
  if (!plan || !incident) {
    order.state = 'blocked';
    order.blockedReason = CommandRejection.UnknownIncident;
    order.progress = 'Blocked';
    return;
  }
  if (incident.state === 'resolved') {
    finishOrder(world, order, plan, 'Incident resolved');
    noteInfo(world, `order:${order.id}:resolved`, 'Incident resolved.');
    return;
  }
  if (world.autonomy === 'manual' && !order.committed) {
    order.state = 'awaiting';
    order.progress = 'Direct control';
    return;
  }
  if (!companyOnScene(world)) {
    if (world.autonomy === 'manual') return;
    if (!respondOpen(world)) {
      const result = respondToIncident(world, world.team.id, order.incidentId);
      if (!result.ok) {
        order.state = 'blocked';
        order.blockedReason = result.reason ?? CommandRejection.NoPath;
        order.progress = 'Response blocked';
        noteHazard(world, `order:${order.id}:respond`, order.blockedReason);
        return;
      }
    }
    order.state = 'running';
    order.blockedReason = null;
    order.progress = 'Responding';
    plan.phase = 'responding';
    return;
  }
  if (order.progress === 'Responding') {
    noteInfo(world, `order:${order.id}:arrived`, 'Engine 1 arrived on scene.');
  }
  const interior = plan.strategy === 'offensive' || plan.strategy === 'rescue' || plan.strategy === 'containment';
  if (!interior && !order.committed) {
    if (plan.strategy === 'defensive' && !order.posted) {
      const moved = defendExposure(world, world.team.id, order.incidentId);
      order.posted = true;
      if (!moved.ok) {
        order.state = 'blocked';
        order.blockedReason = moved.reason ?? CommandRejection.NoPath;
        order.progress = 'Defense blocked';
        return;
      }
    }
    order.state = 'running';
    order.blockedReason = null;
    order.progress = plan.strategy === 'hold' ? 'Holding position' : 'Defensive positions';
    plan.phase = plan.strategy === 'hold' ? 'idle' : 'defending';
    if (plan.strategy === 'hold') noteInfo(world, `order:${order.id}:hold`, 'Engine 1 is holding position.');
    return;
  }
  if (world.autonomy === 'supervised' && !order.approved && !order.committed) {
    order.state = 'awaiting';
    order.decision = 'Approve fire attack';
    order.progress = 'Awaiting approval';
    noteInfo(world, `order:${order.id}:approval`, 'Awaiting approval to start the fire attack.');
    return;
  }
  if (world.autonomy === 'manual') {
    if (fireControlledFor(world, order.incidentId) && !pendingOverhaul(world, order.incidentId)) {
      finishOrder(world, order, plan, 'Incident resolved');
    }
    return;
  }
  if (fireControlledFor(world, order.incidentId)) {
    const roomId = pendingOverhaul(world, order.incidentId);
    if (roomId) {
      order.progress = 'Overhaul';
      plan.phase = 'attacking';
      if (!overhaulOpen(world, roomId)) {
        const responderId = freeResponder(world);
        if (!responderId) {
          order.blockedReason = 'Insufficient personnel for overhaul';
          noteHazard(world, `order:${order.id}:overhaul`, 'Insufficient personnel for overhaul.');
          return;
        }
        const result = applyBuildingCommand(world, { type: 'overhaul-room', responderId, roomId });
        if (!result.ok) {
          order.blockedReason = result.reason ?? CommandRejection.NoPath;
          return;
        }
        order.blockedReason = null;
      }
      return;
    }
    finishOrder(world, order, plan, 'Fire contained');
    noteInfo(world, `order:${order.id}:contained`, 'Fire contained.');
    return;
  }
  if (attackOpen(world)) {
    if (!order.committed) noteInfo(world, `order:${order.id}:attack`, 'Interior attack established.');
    order.committed = true;
    order.state = 'running';
    order.blockedReason = null;
    order.progress = 'Attacking';
    plan.phase = 'attacking';
    plan.order = 'attack';
    return;
  }
  if (order.committed) {
    order.progress = 'Attack stalled';
    order.blockedReason = order.blockedReason ?? 'Fire attack stopped before knockdown';
    return;
  }
  const result = applyWaterCommand(world, {
    type: 'establish-fire-attack',
    teamId: world.team.id,
    incidentId: order.incidentId,
  });
  if (!result.ok) {
    order.state = 'blocked';
    order.blockedReason = result.reason ?? CommandRejection.NoPath;
    order.progress = 'Attack blocked';
    plan.phase = 'blocked';
    plan.blockedReason = order.blockedReason;
    noteHazard(world, `order:${order.id}:attack`, order.blockedReason);
    return;
  }
  order.committed = true;
  order.state = 'running';
  order.blockedReason = null;
  order.progress = 'Attacking';
  plan.phase = 'attacking';
  plan.order = 'attack';
  plan.blockedReason = null;
  noteInfo(world, `order:${order.id}:attack`, 'Interior attack established.');
}

function advanceRespond(world: World, order: StrategicOrder): void {
  if (!companyOnScene(world)) {
    order.progress = 'Responding';
    return;
  }
  order.state = 'complete';
  order.progress = 'On scene';
  order.blockedReason = null;
}

function advanceWithdraw(world: World, order: StrategicOrder): void {
  if (attackOpen(world) || respondOpen(world)) {
    order.progress = 'Withdrawing';
    return;
  }
  const moving = [...world.tasks.values()].some(
    (task) => task.kind === 'move' && task.policy === 'avoid-hazard' && isOpen(task.state),
  );
  if (moving) {
    order.progress = 'Withdrawing';
    return;
  }
  order.state = 'complete';
  order.progress = 'Withdrawn';
  order.blockedReason = null;
}

function advanceReturn(world: World, order: StrategicOrder): void {
  const vehicleId = world.team.apparatusId;
  const vehicle = vehicleId ? world.entities.get(vehicleId)?.vehicle : undefined;
  if (!vehicle || !vehicleId) {
    order.state = 'blocked';
    order.blockedReason = CommandRejection.NoVehicle;
    order.progress = 'Return blocked';
    return;
  }
  const onFoot = world.team.memberIds.filter((memberId) => {
    const entity = world.entities.get(memberId);
    return entity?.responder && !world.detached.has(memberId) && !vehicle.occupants.includes(memberId);
  });
  if (onFoot.length === 0 && vehicle.status === 'idle') {
    order.state = 'complete';
    order.progress = 'In service';
    order.blockedReason = null;
    noteInfo(world, `order:${order.id}:service`, `${world.team.name} returned to service.`);
    return;
  }
  if (order.posted) {
    order.progress = 'Returning to service';
    return;
  }
  const boarded = applyVehicleCommand(world, { type: 'board-team', teamId: world.team.id, vehicleId });
  order.posted = true;
  if (!boarded.ok && onFoot.length > 0) {
    order.state = 'blocked';
    order.blockedReason = boarded.reason ?? CommandRejection.NoPath;
    order.progress = 'Return blocked';
    return;
  }
  order.state = 'running';
  order.blockedReason = null;
  order.progress = 'Returning to service';
}

function finishOrder(
  world: World,
  order: StrategicOrder,
  plan: OperationPlan,
  progress: string,
): void {
  order.state = 'complete';
  order.progress = progress;
  order.blockedReason = null;
  order.decision = null;
  plan.phase = 'complete';
  plan.order = 'none';
  plan.blockedReason = null;
  void world;
}

function ensureStrategic(
  world: World,
  kind: StrategicOrder['kind'],
  incidentId: string,
  companyId: string,
): StrategicOrder {
  const existing = world.strategicOrders.find(
    (order) =>
      order.kind === kind &&
      order.incidentId === incidentId &&
      (order.state === 'running' || order.state === 'awaiting' || order.state === 'blocked'),
  );
  if (existing) return existing;
  const order: StrategicOrder = {
    id: nextIdentifier(world, 'order'),
    kind,
    incidentId,
    companyId,
    priority: 1,
    state: 'running',
    progress: 'Assigned',
    blockedReason: null,
    decision: null,
    approved: false,
    committed: false,
    posted: false,
  };
  world.strategicOrders.push(order);
  return order;
}

function companyOnScene(world: World): boolean {
  const vehicleId = world.team.apparatusId;
  const vehicle = vehicleId ? world.entities.get(vehicleId)?.vehicle : undefined;
  const staging = stagingNode(world);
  return Boolean(
    vehicle && staging && vehicle.status === 'idle' && vehicle.nodeId === staging && vehicle.occupants.length === 0,
  );
}

function respondOpen(world: World): boolean {
  return [...world.tasks.values()].some((task) => task.kind === 'respond' && isOpen(task.state));
}

function attackOpen(world: World): boolean {
  return [...world.tasks.values()].some((task) => task.kind === 'establish-fire-attack' && isOpen(task.state));
}

function overhaulOpen(world: World, roomId: string): boolean {
  return [...world.tasks.values()].some(
    (task) => task.kind === 'overhaul' && task.targetId === roomId && isOpen(task.state),
  );
}

function pendingOverhaul(world: World, incidentId: string): string | null {
  for (const objective of world.objectives.values()) {
    if (objective.incidentId !== incidentId || objective.kind !== 'overhaul-room') continue;
    if (objective.state === 'satisfied') continue;
    return objective.targetId;
  }
  return null;
}

function fireControlledFor(world: World, incidentId: string): boolean {
  for (const objective of world.objectives.values()) {
    if (objective.incidentId !== incidentId || objective.kind !== 'suppress-fire') continue;
    return fireControlled(world, objective.targetId);
  }
  return false;
}

function freeResponder(world: World): string | undefined {
  return world.team.memberIds.find((memberId) => {
    if (world.detached.has(memberId)) return false;
    const entity = world.entities.get(memberId);
    if (!entity?.responder || entity.responder.aboardVehicleId) return false;
    return ![...world.tasks.values()].some(
      (task) => task.assigneeId === memberId && isOpen(task.state) && task.source === 'team',
    );
  });
}

function planOf(world: World): OperationPlan | undefined {
  return world.plans.values().next().value;
}

function postCrew(
  world: World,
  anchor: Tile,
  kind: 'staging' | 'withdrawal' | 'assembly',
): CommandResult {
  const members = world.team.memberIds.filter((memberId) => {
    const entity = world.entities.get(memberId);
    return entity?.responder && !entity.responder.aboardVehicleId && entity.position;
  });
  if (members.length === 0) return { ok: false, reason: CommandRejection.Aboard };
  const used = new Set<string>();
  let posted = 0;
  let reason: string = CommandRejection.NoPath;
  for (const memberId of members) {
    const entity = world.entities.get(memberId);
    if (!entity?.position) continue;
    const aboard = blocksPedestrian(entity);
    if (aboard) {
      reason = aboard;
      continue;
    }
    const from = tileOf(entity.position);
    const choices = spacedTiles(world, anchor, 20).filter((tile) => !used.has(tileKey(tile)));
    let chosen: Tile | null = null;
    for (const tile of choices) {
      const position = workPosition(world, from, kind, tile);
      if (!position.tile) continue;
      chosen = position.tile;
      break;
    }
    if (!chosen) continue;
    used.add(tileKey(chosen));
    const task = createMove(world, memberId, chosen, kind === 'withdrawal' ? 'avoid-hazard' : 'direct');
    overrideWith(world, memberId, task.id);
    posted += 1;
  }
  if (posted === 0) return { ok: false, reason };
  return { ok: true };
}

function createMove(world: World, assigneeId: string, destination: Tile, policy: MoveTask['policy']): MoveTask {
  const task: MoveTask = {
    id: nextIdentifier(world, 'task'),
    kind: 'move',
    state: 'pending',
    assigneeId,
    source: 'individual',
    destination: { ...destination },
    reservations: [],
    ...(policy && policy !== 'direct' ? { policy } : {}),
  };
  transition(task, 'ready');
  transition(task, 'running');
  world.tasks.set(task.id, task);
  return task;
}

function cancelCrewWork(world: World): void {
  for (const task of [...world.tasks.values()]) {
    if (!isOpen(task.state)) continue;
    if (task.kind === 'establish-fire-attack' || task.kind === 'search-building' || task.kind === 'respond') {
      cancelTask(world, task);
    }
  }
}

function ensurePlan(world: World, incidentId: string): OperationPlan | undefined {
  if (!world.incidents.has(incidentId)) return undefined;
  const existing = world.plans.get(incidentId);
  if (existing) return existing;
  const plan = defaultPlan(incidentId);
  world.plans.set(incidentId, plan);
  return plan;
}

function stagingNode(world: World): string | undefined {
  const nodes = [...world.roadNodes.values()].sort((left, right) => (left.id < right.id ? -1 : 1));
  return nodes.find((node) => node.kind === 'staging')?.id ?? nodes[0]?.id;
}

function incidentAnchor(world: World, incidentId: string): Tile {
  const zone = world.zones.find((item) => item.incidentId === incidentId && item.kind === 'assembly');
  if (zone) return { x: zone.x, y: zone.y };
  const objective = [...world.objectives.values()].find((item) => item.incidentId === incidentId);
  const fire = objective ? world.entities.get(objective.targetId) : undefined;
  if (fire?.position) return tileOf(fire.position);
  return { x: 0, y: 0 };
}
