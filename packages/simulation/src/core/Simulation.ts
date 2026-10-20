import {
  FIXED_DT_MS,
  TICK_RATE_HZ,
  scenarioSchema,
  type CarriedEquipment,
  type Command,
  type ObjectSnapshot,
  type Scenario,
  type SimulationSnapshot,
  type SaveDocument,
  type TaskSnapshot,
} from '@emergency/protocol';

import type { EquipmentInstance } from '../components/equipment.ts';
import type { IncidentRecord, ObjectiveRecord } from '../components/incident.ts';
import type { Entity } from '../entities/Entity.ts';
import { inBounds, isBlocked, isWalkable, tileCenter, tileKey, tileOf } from '../navigation/grid.ts';
import { buildAdjacency } from '../navigation/road.ts';
import { stepFire } from '../systems/fireSystem.ts';
import { fireControlled, incidentPhase, incidentTrend } from '../systems/hazardQuery.ts';
import { exposureRows, hazardRows, stepHazards } from '../systems/hazardSystem.ts';
import { stepWater } from '../systems/waterSystem.ts';
import { stepMovement } from '../systems/movementSystem.ts';
import { stepVehicles, syncOccupants } from '../systems/vehicleSystem.ts';
import { evaluateIncidents } from '../tasks/fireRules.ts';
import { stepTasks } from '../tasks/interactions.ts';
import { loadBuildings, revealRooms } from '../tasks/building.ts';
import { doorPassable } from '../components/building.ts';
import { computeInteractionTiles } from '../tasks/lifecycle.ts';
import { scanStatus, seedStatus } from '../tasks/notices.ts';
import { orderLabel } from '../tasks/orders.ts';
import { routeLength } from '../tasks/waterRules.ts';
import { applyCommand, promoteQueued, type CommandResult } from '../tasks/moveTasks.ts';
import type { Task } from '../tasks/types.ts';
import { isWaterTask } from '../tasks/types.ts';
import { exportWorld, readSave } from '../persistence/save.ts';
import { createRng } from './rng.ts';
import { MAX_TICKS_PER_STEP, type World } from './world.ts';

export interface RestoredSimulation {
  ok: true;
  simulation: Simulation;
}

export interface RejectedSave {
  ok: false;
  message: string;
}

export class Simulation {
  private readonly world: World;

  private constructor(world: World) {
    this.world = world;
  }

  static create(scenario: Scenario): Simulation {
    const world = createWorld(scenario);
    seedStatus(world);
    return new Simulation(world);
  }

  static fromWorld(world: World): Simulation {
    seedStatus(world);
    return new Simulation(world);
  }

  apply(command: Command): CommandResult {
    return applyCommand(this.world, command);
  }

  /** Advance one fixed step. A paused simulation does not move or increment time. */
  tick(): void {
    if (this.world.paused) return;
    this.world.tick += 1;
    stepMovement(this.world);
    stepVehicles(this.world);
    stepWater(this.world);
    stepFire(this.world);
    stepTasks(this.world);
    stepHazards(this.world);
    revealRooms(this.world);
    evaluateIncidents(this.world);
    syncOccupants(this.world);
    promoteQueued(this.world);
    scanStatus(this.world);
  }

  /** Catch up by whole fixed steps. Partial time is kept until the next call. */
  step(dtMs: number): number {
    if (this.world.paused || !Number.isFinite(dtMs) || dtMs <= 0) return 0;
    this.world.accumulatorMs += dtMs;
    let ticks = 0;
    while (this.world.accumulatorMs >= FIXED_DT_MS && ticks < MAX_TICKS_PER_STEP) {
      this.tick();
      this.world.accumulatorMs -= FIXED_DT_MS;
      ticks += 1;
    }
    return ticks;
  }

  getSnapshot(): SimulationSnapshot {
    return snapshotOf(this.world);
  }

  currentTick(): number {
    return this.world.tick;
  }

  /** Capture the world after the last completed tick. Partial frame time is not stored. */
  exportSave(): SaveDocument {
    return exportWorld(this.world);
  }
}

export function createSimulation(scenario: Scenario): Simulation {
  return Simulation.create(scenario);
}

/** Build a new simulation from a save. The caller keeps the previous instance on failure. */
export function restoreSimulation(input: unknown): RestoredSimulation | RejectedSave {
  const read = readSave(input);
  if (!read.ok) return read;
  return { ok: true, simulation: Simulation.fromWorld(read.world) };
}

function createWorld(scenarioInput: Scenario): World {
  const scenario = scenarioSchema.parse(scenarioInput);
  const responderIds = new Set<string>();
  for (const responder of scenario.responders) {
    if (responderIds.has(responder.id)) {
      throw new Error(`Duplicate responder id ${responder.id}`);
    }
    responderIds.add(responder.id);
  }

  for (const memberId of scenario.team.memberIds) {
    if (!responderIds.has(memberId)) {
      throw new Error(`Team member ${memberId} has no responder`);
    }
  }

  const blocked = new Set<string>();
  for (const tile of scenario.blocked) {
    if (!inBounds(scenario.width, scenario.height, tile)) {
      throw new Error(`Blocked tile ${tile.x},${tile.y} is outside the map`);
    }
    blocked.add(tileKey(tile));
  }

  for (const object of scenario.objects) {
    if (!inBounds(scenario.width, scenario.height, object.position)) {
      throw new Error(`Object ${object.id} is outside the map`);
    }
    if (object.objectType === 'door' && !doorPassable(object.state))
      blocked.add(tileKey(object.position));
  }

  const entities = new Map<string, Entity>();
  for (const responder of scenario.responders) {
    if (isBlocked(blocked, responder.position)) {
      throw new Error(`Responder ${responder.id} spawns on a blocked tile`);
    }
    if (!inBounds(scenario.width, scenario.height, responder.position)) {
      throw new Error(`Responder ${responder.id} spawns outside the map`);
    }
    const center = tileCenter(responder.position);
    entities.set(responder.id, {
      id: responder.id,
      position: { x: center.x, y: center.y },
      movement: { speed: responder.speed, path: [], destination: null },
      responder: { name: responder.name },
      teamMembership: { teamId: scenario.team.id },
    });
  }

  const objectIds = new Set<string>();
  for (const object of scenario.objects) {
    if (objectIds.has(object.id) || entities.has(object.id)) {
      throw new Error(`Duplicate entity id ${object.id}`);
    }
    if (object.objectType !== 'door' && object.objectType !== 'window' && isBlocked(blocked, object.position)) {
      throw new Error(`Object ${object.id} is on a blocked tile`);
    }
    objectIds.add(object.id);
  }

  for (const object of scenario.objects) {
    const center = tileCenter(object.position);
    entities.set(object.id, {
      id: object.id,
      position: { x: center.x, y: center.y },
      interactable: {
        name: object.name,
        objectType: object.objectType,
        state: object.state,
        ...(object.requiredCapability ? { requiredCapability: object.requiredCapability } : {}),
        interactionTiles: computeInteractionTiles(
          { width: scenario.width, height: scenario.height, blocked },
          object.position,
          object.objectType,
        ),
      },
    });
  }

  const roadNodes = new Map(
    scenario.roadNodes.map((node) => [node.id, { ...node.position, id: node.id, kind: node.kind }]),
  );
  for (const edge of scenario.roadEdges) {
    if (!roadNodes.has(edge.from) || !roadNodes.has(edge.to)) {
      throw new Error(`Road edge ${edge.from}->${edge.to} references an unknown node`);
    }
  }
  const catalogByVehicle = new Map(
    scenario.vehicleCatalog.map((definition) => [definition.id, definition]),
  );
  for (const placement of scenario.vehicles) {
    if (entities.has(placement.id)) throw new Error(`Duplicate entity id ${placement.id}`);
    const definition = catalogByVehicle.get(placement.definitionId);
    if (!definition) throw new Error(`Unknown vehicle definition ${placement.definitionId}`);
    const node = roadNodes.get(placement.nodeId);
    if (!node) throw new Error(`Vehicle ${placement.id} has an unknown node`);
    if (!inBounds(scenario.width, scenario.height, node) || isBlocked(blocked, node)) {
      throw new Error(`Vehicle ${placement.id} spawns on a blocked tile`);
    }
    const center = tileCenter(node);
    const designatedDriverId = scenario.team.memberIds[0];
    if (!designatedDriverId) throw new Error(`Vehicle ${placement.id} has no designated driver`);
    entities.set(placement.id, {
      id: placement.id,
      position: { x: center.x, y: center.y },
      movement: { speed: definition.speed, path: [], destination: null },
      vehicle: {
        definitionId: definition.id,
        name: placement.name,
        heading: placement.heading,
        footprint: { width: definition.footprint.width, height: definition.footprint.height },
        capacity: definition.capacity,
        occupants: [],
        driverId: null,
        designatedDriverId,
        status: 'idle',
        nodeId: node.id,
        destinationNodeId: null,
        seatReservations: [],
        pump: definition.pump
          ? {
              state: 'off',
              pressure: 0,
              maxDelivery: definition.pump.maxDelivery,
              tankCapacity: definition.pump.tankCapacity,
              tank: definition.pump.tankCapacity,
              intakeId: null,
              discharges: [],
              delivered: 0,
            }
          : null,
      },
    });
  }

  for (const hydrant of scenario.hydrants) {
    if (entities.has(hydrant.id)) throw new Error(`Duplicate entity id ${hydrant.id}`);
    if (!inBounds(scenario.width, scenario.height, hydrant.position) || isBlocked(blocked, hydrant.position)) {
      throw new Error(`Hydrant ${hydrant.id} is not on an open tile`);
    }
    const center = tileCenter(hydrant.position);
    const interactionTiles = [
      { x: hydrant.position.x + 1, y: hydrant.position.y },
      { x: hydrant.position.x - 1, y: hydrant.position.y },
      { x: hydrant.position.x, y: hydrant.position.y + 1 },
      { x: hydrant.position.x, y: hydrant.position.y - 1 },
    ].filter((tile) => isWalkable(scenario.width, scenario.height, blocked, tile));
    entities.set(hydrant.id, {
      id: hydrant.id,
      position: { x: center.x, y: center.y },
      hydrant: {
        name: hydrant.name,
        available: true,
        flowCapacity: hydrant.flowCapacity,
        connectionId: null,
        interactionTiles,
      },
    });
  }

  const catalog = new Map(
    scenario.equipmentCatalog.map((definition) => [
      definition.id,
      {
        id: definition.id,
        name: definition.name,
        capabilities: [...definition.capabilities],
        agent: definition.agent ?? null,
        suppression: definition.suppression ?? 0,
        maxLength: definition.maxLength ?? null,
      },
    ]),
  );
  const equipment = new Map<string, EquipmentInstance>();
  for (const placement of scenario.equipment) {
    if (equipment.has(placement.id)) throw new Error(`Duplicate equipment id ${placement.id}`);
    if (!catalog.has(placement.definitionId)) {
      throw new Error(`Unknown equipment definition ${placement.definitionId}`);
    }
    if (Boolean(placement.ownerId) === Boolean(placement.locationId)) {
      throw new Error(`Equipment ${placement.id} needs one owner or one storage location`);
    }
    if (placement.ownerId && !entities.get(placement.ownerId)?.responder) {
      throw new Error(`Equipment ${placement.id} has an unknown owner`);
    }
    if (placement.locationId) {
      const storage = entities.get(placement.locationId);
      const storedInLocker = storage?.interactable?.objectType === 'locker';
      if (!storedInLocker && !storage?.vehicle) {
        throw new Error(`Equipment ${placement.id} is not stored in a locker or vehicle`);
      }
    }
    equipment.set(placement.id, {
      id: placement.id,
      definitionId: placement.definitionId,
      ownerId: placement.ownerId ?? null,
      locationId: placement.locationId ?? null,
      reservedByTaskId: null,
      agent: catalog.get(placement.definitionId)?.agent ?? null,
    });
  }

  for (const fire of scenario.fires) {
    if (entities.has(fire.id)) throw new Error(`Duplicate entity id ${fire.id}`);
    if (
      !inBounds(scenario.width, scenario.height, fire.position) ||
      isBlocked(blocked, fire.position)
    ) {
      throw new Error(`Fire ${fire.id} is on a blocked tile`);
    }
    if (fire.intensity > fire.maxIntensity) {
      throw new Error(`Fire ${fire.id} starts above its maximum intensity`);
    }
    const center = tileCenter(fire.position);
    entities.set(fire.id, {
      id: fire.id,
      position: { x: center.x, y: center.y },
      fire: {
        name: fire.name,
        intensity: fire.intensity,
        maxIntensity: fire.maxIntensity,
        fuel: fire.fuel,
        growth: fire.growth,
        fuelUse: fire.fuelUse,
        range: fire.range,
      },
    });
  }

  const incidents = new Map<string, IncidentRecord>();
  const objectives = new Map<string, ObjectiveRecord>();
  for (const incident of scenario.incidents) {
    if (incidents.has(incident.id) || entities.has(incident.id)) {
      throw new Error(`Duplicate incident id ${incident.id}`);
    }
    incidents.set(incident.id, { id: incident.id, name: incident.name, state: 'active' });
    for (const objective of incident.objectives) {
      if (objectives.has(objective.id)) throw new Error(`Duplicate objective id ${objective.id}`);
      if (objective.kind === 'suppress-fire' && !entities.get(objective.targetId)?.fire) {
        throw new Error(`Objective ${objective.id} has an unknown fire`);
      }
      objectives.set(objective.id, {
        id: objective.id,
        incidentId: incident.id,
        kind: objective.kind,
        targetId: objective.targetId,
        state: 'open',
      });
    }
  }

  const structure = loadBuildings(scenario);
  for (const wall of structure.walls) blocked.add(tileKey(wall));
  for (const objective of objectives.values()) {
    if (objective.kind === 'overhaul-room' && !structure.rooms.has(objective.targetId)) {
      throw new Error(`Objective ${objective.id} has an unknown room`);
    }
  }

  return {
    scenarioId: scenario.id,
    seed: scenario.seed,
    rng: createRng(scenario.seed),
    width: scenario.width,
    height: scenario.height,
    blocked,
    entities,
    tasks: new Map(),
    equipment,
    catalog,
    inventoryCapacity: scenario.inventoryCapacity,
    team: {
      id: scenario.team.id,
      name: scenario.team.name,
      memberIds: [...scenario.team.memberIds],
      ...(scenario.team.apparatusId ? { apparatusId: scenario.team.apparatusId } : {}),
    },
    roadNodes,
    adjacency: buildAdjacency(scenario.roadEdges),
    roadEdges: scenario.roadEdges.map((edge) => ({ from: edge.from, to: edge.to })),
    reservedNodes: new Map(),
    reservedExits: new Map(),
    incidents,
    objectives,
    tick: 0,
    paused: false,
    accumulatorMs: 0,
    nextId: 1,
    orders: [],
    notices: [],
    statusStamp: new Map(),
    noticeLatch: new Set(),
    buildings: structure.buildings,
    floors: structure.floors,
    rooms: structure.rooms,
    doorLinks: structure.doorLinks,
    reservedDoors: new Map(),
    hazards: new Map(),
    exposure: new Map(),
    furnishings: new Map(
      scenario.furnishings.map((item) => [
        item.id,
        { id: item.id, name: item.name, x: item.position.x, y: item.position.y, materialId: item.materialId },
      ]),
    ),
    damage: new Map(),
    routeEpoch: 0,
  };
}

function snapshotOf(world: World): SimulationSnapshot {
  const entities = [...world.entities.values()]
    .filter(
      (entity) => entity.position && entity.movement && entity.responder && entity.teamMembership,
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((entity) => {
      const position = entity.position;
      const movement = entity.movement;
      const responder = entity.responder;
      const membership = entity.teamMembership;
      if (!position || !movement || !responder || !membership) {
        throw new Error(`Entity ${entity.id} is missing a required component`);
      }
      const snapshot = {
        id: entity.id,
        name: responder.name,
        teamId: membership.teamId,
        position: { x: position.x, y: position.y },
        speed: movement.speed,
        activeTaskId: activeRoot(world, entity.id)?.id ?? null,
        path: movement.path.map((point) => ({ x: point.x, y: point.y })),
        inventory: inventoryOf(world, entity.id),
        ...(responder.aboardVehicleId ? { aboardVehicleId: responder.aboardVehicleId } : {}),
      };
      return snapshot;
    });

  const tasks = [...world.tasks.values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((task) => snapshotTask(world, task));

  const objects = [...world.entities.values()]
    .filter((entity) => entity.interactable && entity.position)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((entity) => snapshotObject(world, entity));

  const blocked = [...world.blocked]
    .map((key) => {
      const [xText, yText] = key.split(',');
      return { x: Number(xText), y: Number(yText) };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);

  return {
    scenarioId: world.scenarioId,
    seed: world.seed,
    rngState: world.rng.getState(),
    tick: world.tick,
    paused: world.paused,
    tickRate: TICK_RATE_HZ,
    width: world.width,
    height: world.height,
    blocked,
    team: {
      id: world.team.id,
      name: world.team.name,
      memberIds: [...world.team.memberIds],
      ...(world.team.apparatusId ? { apparatusId: world.team.apparatusId } : {}),
    },
    entities,
    objects,
    vehicles: [...world.entities.values()]
      .filter((entity) => entity.vehicle && entity.position)
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((entity) => snapshotVehicle(world, entity)),
    roads: [...world.roadNodes.values()]
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((node) => ({
        id: node.id,
        position: { x: node.x, y: node.y },
        kind: node.kind,
      })),
    roadEdges: world.roadEdges.map((edge) => ({ from: edge.from, to: edge.to })),
    inventoryCapacity: world.inventoryCapacity,
    tasks,
    fires: [...world.entities.values()]
      .filter((entity) => entity.fire && entity.position)
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((entity) => {
        const fire = entity.fire;
        const position = entity.position;
        if (!fire || !position) throw new Error(`Fire ${entity.id} is incomplete`);
        return {
          id: entity.id,
          name: fire.name,
          position: tileOf(position),
          intensity: fire.intensity,
          maxIntensity: fire.maxIntensity,
          fuel: fire.fuel,
          out: fireControlled(world, entity.id),
        };
      }),
    hydrants: [...world.entities.values()]
      .filter((entity) => entity.hydrant && entity.position)
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((entity) => {
        const hydrant = entity.hydrant;
        const position = entity.position;
        if (!hydrant || !position) throw new Error(`Hydrant ${entity.id} is incomplete`);
        return {
          id: entity.id,
          name: hydrant.name,
          position: tileOf(position),
          available: hydrant.available,
          flowCapacity: hydrant.flowCapacity,
          connectionId: hydrant.connectionId,
        };
      }),
    hoses: [...world.entities.values()]
      .filter((entity) => entity.hose)
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((entity) => {
        const hose = entity.hose;
        if (!hose) throw new Error(`Hose ${entity.id} is incomplete`);
        return {
          id: entity.id,
          name: hose.name,
          kind: hose.kind,
          state: hose.state,
          sourceId: hose.sourceId,
          targetId: hose.targetId,
          operatorId: hose.operatorId,
          length: routeLength(hose.route),
          maxLength: hose.maxLength,
          flow: hose.flow,
          route: hose.route.map((point) => ({ x: point.x, y: point.y })),
        };
      }),
    incidents: [...world.incidents.values()]
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((incident) => {
        const targets = [...world.objectives.values()]
          .filter((objective) => objective.incidentId === incident.id && objective.kind === 'suppress-fire')
          .map((objective) => objective.targetId);
        return {
          id: incident.id,
          name: incident.name,
          state: incident.state,
          phase: incident.state === 'resolved' ? ('resolved' as const) : incidentPhase(world, targets),
          trend: incidentTrend(world, targets),
          objectives: [...world.objectives.values()]
            .filter((objective) => objective.incidentId === incident.id)
            .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
            .map((objective) => ({
              id: objective.id,
              kind: objective.kind,
              targetId: objective.targetId,
              state: objective.state,
            })),
        };
      }),
    orders: world.orders.map((order) => ({
      id: order.id,
      assigneeId: order.command.responderId,
      label: orderLabel(order.command),
      destination:
        order.command.type === 'move-responder' ? { ...order.command.destination } : null,
    })),
    notices: world.notices.map((notice) => ({
      id: notice.id,
      tick: notice.tick,
      message: notice.message,
      tone: notice.tone,
    })),
    buildings: [...world.buildings.values()]
      .sort((left, right) => (left.id < right.id ? -1 : 1))
      .map((building) => {
        const floor = world.floors.get(building.floorId);
        return {
          id: building.id,
          name: building.name,
          floorId: building.floorId,
          entry: floor ? { ...floor.entry } : { x: 0, y: 0 },
          entranceDoorId: floor?.entranceDoorId ?? '',
          rooms: [...world.rooms.values()]
            .filter((room) => room.buildingId === building.id)
            .map((room) => room.id)
            .sort(),
        };
      }),
    rooms: [...world.rooms.values()]
      .sort((left, right) => (left.id < right.id ? -1 : 1))
      .map((room) => ({
        id: room.id,
        buildingId: room.buildingId,
        floorId: room.floorId,
        name: room.name,
        tiles: room.tiles.map((tile) => ({ ...tile })),
        entrance: { ...room.entrance },
        state: room.state,
        discovered: room.discovered,
        assigneeId: room.assigneeId,
        discoveries: room.discoveries.map((discovery) => ({
          id: discovery.id,
          name: discovery.name,
          found: discovery.found,
        })),
        upperTemp: room.upperTemp,
        lowerTemp: room.lowerTemp,
        smoke: room.smoke,
        oxygen: room.oxygen,
        overhauled: room.overhauled,
      })),
    hazards: hazardRows(world).map((cell) => ({
      x: cell.x,
      y: cell.y,
      temperature: cell.temperature,
      fuel: cell.fuel,
      combustion: cell.combustion,
      smoke: cell.smoke,
      water: cell.water,
      sourceId: cell.sourceId,
      materialId: cell.materialId,
      char: cell.char,
      steam: cell.steam,
      hotspot: cell.hotspot,
      revealed: cell.revealed,
    })),
    exposure: exposureRows(world),
    furnishings: [...world.furnishings.values()]
      .sort((left, right) => (left.id < right.id ? -1 : 1))
      .map((item) => ({
        id: item.id,
        name: item.name,
        position: { x: item.x, y: item.y },
        materialId: item.materialId,
      })),
    damage: [...world.damage.values()]
      .filter((record) => record.integrity < 1)
      .sort((left, right) => left.y - right.y || left.x - right.x)
      .map((record) => ({
        x: record.x,
        y: record.y,
        integrity: record.integrity,
        failed: record.failed,
      })),
  };
}

function activeRoot(world: World, assigneeId: string): Task | undefined {
  const running = [...world.tasks.values()].filter(
    (task) => task.assigneeId === assigneeId && task.state === 'running' && !task.parentId,
  );
  running.sort((left, right) => {
    if (left.source !== right.source) return left.source === 'individual' ? -1 : 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  return running[0];
}

function inventoryOf(world: World, responderId: string): CarriedEquipment[] {
  return [...world.equipment.values()]
    .filter((item) => item.ownerId === responderId)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map((item) => describeEquipment(world, item));
}

function snapshotObject(world: World, entity: Entity): ObjectSnapshot {
  const interactable = entity.interactable;
  const position = entity.position;
  if (!interactable || !position) throw new Error(`Object ${entity.id} is incomplete`);
  const snapshot: ObjectSnapshot = {
    id: entity.id,
    name: interactable.name,
    objectType: interactable.objectType,
    position: tileOf(position),
    state: interactable.state,
    interactionTiles: interactable.interactionTiles.map((tile) => ({ x: tile.x, y: tile.y })),
    contents: storedContents(world, entity.id),
  };
  if (interactable.requiredCapability)
    snapshot.requiredCapability = interactable.requiredCapability;
  return snapshot;
}

function snapshotVehicle(world: World, entity: Entity) {
  const vehicle = entity.vehicle;
  const position = entity.position;
  if (!vehicle || !position) throw new Error(`Vehicle ${entity.id} is incomplete`);
  return {
    id: entity.id,
    name: vehicle.name,
    definitionId: vehicle.definitionId,
    position: { x: position.x, y: position.y },
    heading: vehicle.heading,
    footprint: { width: vehicle.footprint.width, height: vehicle.footprint.height },
    capacity: vehicle.capacity,
    occupants: vehicle.occupants.map((occupantId) => ({
      id: occupantId,
      name: world.entities.get(occupantId)?.responder?.name ?? occupantId,
    })),
    driverId: vehicle.driverId,
    designatedDriverId: vehicle.designatedDriverId,
    status: vehicle.status,
    nodeId: vehicle.nodeId,
    destinationNodeId: vehicle.destinationNodeId,
    speed: entity.movement?.speed ?? 0,
    contents: storedContents(world, entity.id),
    ...(vehicle.pump
      ? {
          pump: {
            state: vehicle.pump.state,
            pressure: vehicle.pump.pressure,
            maxDelivery: vehicle.pump.maxDelivery,
            tank: vehicle.pump.tank,
            tankCapacity: vehicle.pump.tankCapacity,
            intakeId: vehicle.pump.intakeId,
            discharges: [...vehicle.pump.discharges],
          },
        }
      : {}),
  };
}

function storedContents(world: World, locationId: string) {
  return [...world.equipment.values()]
    .filter((item) => item.locationId === locationId && item.ownerId === null)
    .sort((left, right) => {
      const order = [...world.catalog.keys()];
      const leftOrder = order.indexOf(left.definitionId);
      const rightOrder = order.indexOf(right.definitionId);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    })
    .map((item) => ({
      ...describeEquipment(world, item),
      reserved: item.reservedByTaskId !== null,
    }));
}

function describeEquipment(world: World, item: EquipmentInstance): CarriedEquipment {
  const definition = world.catalog.get(item.definitionId);
  return {
    id: item.id,
    definitionId: item.definitionId,
    name: definition?.name ?? item.definitionId,
    capabilities: definition ? [...definition.capabilities] : [],
    ...(item.agent !== null ? { agent: item.agent } : {}),
  };
}

function snapshotTask(world: World, task: Task): TaskSnapshot {
  const common = {
    id: task.id,
    state: task.state,
    assigneeId: task.assigneeId,
    source: task.source,
    ...(task.groupId ? { groupId: task.groupId } : {}),
    ...(task.suspendedByTaskId ? { suspendedByTaskId: task.suspendedByTaskId } : {}),
    ...(task.failureReason ? { failureReason: task.failureReason } : {}),
    ...(task.parentId ? { parentId: task.parentId } : {}),
  };
  if (task.kind === 'move') {
    return {
      ...common,
      kind: 'move',
      destination: { x: task.destination.x, y: task.destination.y },
    };
  }
  if (task.kind === 'interact') {
    return {
      ...common,
      kind: 'interact',
      targetId: task.targetId,
      action: task.action,
      step: task.step,
      progressTicks: task.progressTicks,
      durationTicks: task.durationTicks,
    };
  }
  const progress = displayedProgress(world, task);
  if (task.kind === 'retrieve-equipment') {
    return {
      ...common,
      kind: 'retrieve-equipment',
      targetId: task.targetId,
      definitionId: task.definitionId,
      ...progress,
    };
  }
  if (task.kind === 'force-door' || task.kind === 'operate-panel') {
    return { ...common, kind: task.kind, targetId: task.targetId, ...progress };
  }
  if (task.kind === 'board-vehicle' || task.kind === 'exit-vehicle') {
    return { ...common, kind: task.kind, targetId: task.targetId, ...progress };
  }
  if (task.kind === 'suppress-fire' || task.kind === 'suppress-incident') {
    return { ...common, kind: task.kind, targetId: task.targetId, ...progress };
  }
  if (isWaterTask(task)) {
    return {
      ...common,
      kind: task.kind,
      targetId: task.targetId,
      ...progress,
      ...(task.equipmentId ? { equipmentId: task.equipmentId } : {}),
      ...(task.vehicleId ? { vehicleId: task.vehicleId } : {}),
      ...(task.hydrantId ? { hydrantId: task.hydrantId } : {}),
      ...(task.hoseEntityId ? { hoseId: task.hoseEntityId } : {}),
      ...(task.destination ? { destination: { x: task.destination.x, y: task.destination.y } } : {}),
      ...(task.role ? { role: task.role } : {}),
    };
  }
  if (task.kind === 'drive-vehicle') {
    return {
      ...common,
      kind: 'drive-vehicle',
      targetId: task.targetId,
      destinationNodeId: task.destinationNodeId,
      ...progress,
    };
  }
  if (task.kind === 'respond') {
    return {
      ...common,
      kind: 'respond',
      targetId: task.targetId,
      destinationNodeId: task.destinationNodeId,
      disembark: task.disembark,
      ...progress,
    };
  }
  if (
    task.kind === 'open-door' ||
    task.kind === 'close-door' ||
    task.kind === 'search-building' ||
    task.kind === 'ventilate' ||
    task.kind === 'overhaul'
  ) {
    return { ...common, kind: task.kind, targetId: task.targetId, ...progress };
  }
  if (task.kind === 'search-room') {
    return {
      ...common,
      kind: 'search-room',
      targetId: task.targetId,
      searchIndex: task.searchIndex,
      ...progress,
    };
  }
  const unreachable: never = task;
  return unreachable;
}

function displayedProgress(
  world: World,
  task: Task & { step: string; progressTicks: number; durationTicks: number; childTaskId?: string },
): { step: string; progressTicks: number; durationTicks: number } {
  const child = task.childTaskId ? world.tasks.get(task.childTaskId) : undefined;
  if (child?.kind === 'interact') {
    return {
      step: 'interact',
      progressTicks: child.progressTicks,
      durationTicks: child.durationTicks,
    };
  }
  return {
    step: task.step,
    progressTicks: task.progressTicks,
    durationTicks: task.durationTicks,
  };
}
