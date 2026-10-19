import {
  SAVE_SCHEMA_VERSION,
  prepareSaveDocument,
  saveDocumentSchema,
  saveSchemaMessage,
  type SaveDocument,
  type SaveEntity,
  type SaveTask,
} from '@emergency/protocol';

import type { EquipmentInstance } from '../components/equipment.ts';
import type { World } from '../core/world.ts';
import { createRng } from '../core/rng.ts';
import type { Entity } from '../entities/Entity.ts';
import { inBounds, tileKey, tileOf } from '../navigation/grid.ts';
import { buildAdjacency } from '../navigation/road.ts';
import type { Task, WaterTask } from '../tasks/types.ts';
import { isWaterTask } from '../tasks/types.ts';

export interface SaveFailure {
  ok: false;
  message: string;
}

export interface SaveWorld {
  ok: true;
  world: World;
}

export function exportWorld(world: World): SaveDocument {
  return saveDocumentSchema.parse({
    schemaVersion: SAVE_SCHEMA_VERSION,
    scenarioId: world.scenarioId,
    seed: world.seed,
    rngState: world.rng.getState(),
    tick: world.tick,
    paused: world.paused,
    width: world.width,
    height: world.height,
    blocked: [...world.blocked]
      .map((key) => {
        const [x, y] = key.split(',');
        return { x: Number(x), y: Number(y) };
      })
      .sort((left, right) => left.y - right.y || left.x - right.x),
    inventoryCapacity: world.inventoryCapacity,
    nextId: world.nextId,
    team: {
      id: world.team.id,
      name: world.team.name,
      memberIds: [...world.team.memberIds],
      ...(world.team.apparatusId ? { apparatusId: world.team.apparatusId } : {}),
    },
    catalog: [...world.catalog.values()].map((definition) => ({
      id: definition.id,
      name: definition.name,
      capabilities: [...definition.capabilities],
      agent: definition.agent,
      suppression: definition.suppression,
      maxLength: definition.maxLength,
    })),
    equipment: [...world.equipment.values()].map((item) => ({
      id: item.id,
      definitionId: item.definitionId,
      ownerId: item.ownerId,
      locationId: item.locationId,
      reservedByTaskId: item.reservedByTaskId,
      agent: item.agent,
    })),
    entities: [...world.entities.values()].map(exportEntity),
    tasks: [...world.tasks.values()].map(exportTask),
    incidents: [...world.incidents.values()].map((incident) => ({
      id: incident.id,
      name: incident.name,
      state: incident.state,
    })),
    objectives: [...world.objectives.values()].map((objective) => ({
      id: objective.id,
      incidentId: objective.incidentId,
      kind: objective.kind,
      targetId: objective.targetId,
      state: objective.state,
    })),
    roads: [...world.roadNodes.values()].map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      kind: node.kind,
    })),
    roadEdges: world.roadEdges.map((edge) => ({ from: edge.from, to: edge.to })),
    reservedNodes: [...world.reservedNodes.entries()].map(([nodeId, taskId]) => ({
      nodeId,
      taskId,
    })),
    reservedExits: [...world.reservedExits.entries()].map(([key, taskId]) => {
      const [x, y] = key.split(',');
      return { x: Number(x), y: Number(y), taskId };
    }),
    orders: world.orders.map((order) => ({ id: order.id, command: order.command })),
    notices: world.notices.map((notice) => ({
      id: notice.id,
      tick: notice.tick,
      key: notice.key,
      message: notice.message,
      tone: notice.tone,
    })),
  });
}

/** Parse a save and rebuild indexes. Task commands are not run again. */
export function readSave(input: unknown): SaveWorld | SaveFailure {
  const parsed = prepareSaveDocument(input);
  if (!parsed.ok) return { ok: false, message: parsed.message || saveSchemaMessage(input) };
  const document = structuredClone(parsed.document);
  const duplicate = duplicatedId(document);
  if (duplicate) return { ok: false, message: duplicate };
  const world = worldFromDocument(document);
  const message = inconsistent(world);
  if (message) return { ok: false, message };
  return { ok: true, world };
}

function worldFromDocument(document: SaveDocument): World {
  const entities = new Map<string, Entity>();
  for (const record of document.entities) entities.set(record.id, importEntity(record));

  const tasks = new Map<string, Task>();
  for (const task of document.tasks) tasks.set(task.id, importTask(task));

  const equipment = new Map<string, EquipmentInstance>();
  for (const item of document.equipment) {
    equipment.set(item.id, {
      id: item.id,
      definitionId: item.definitionId,
      ownerId: item.ownerId,
      locationId: item.locationId,
      reservedByTaskId: item.reservedByTaskId,
      agent: item.agent,
    });
  }

  const roadNodes = new Map(
    document.roads.map((node) => [node.id, { id: node.id, x: node.x, y: node.y, kind: node.kind }]),
  );

  return {
    scenarioId: document.scenarioId,
    seed: document.seed,
    rng: createRng(document.seed, document.rngState),
    width: document.width,
    height: document.height,
    blocked: new Set(document.blocked.map((tile) => tileKey(tile))),
    entities,
    tasks,
    equipment,
    catalog: new Map(
      document.catalog.map((definition) => [
        definition.id,
        {
          id: definition.id,
          name: definition.name,
          capabilities: [...definition.capabilities],
          agent: definition.agent,
          suppression: definition.suppression,
          maxLength: definition.maxLength ?? null,
        },
      ]),
    ),
    inventoryCapacity: document.inventoryCapacity,
    team: {
      id: document.team.id,
      name: document.team.name,
      memberIds: [...document.team.memberIds],
      ...(document.team.apparatusId ? { apparatusId: document.team.apparatusId } : {}),
    },
    roadNodes,
    adjacency: buildAdjacency(document.roadEdges),
    roadEdges: document.roadEdges.map((edge) => ({ from: edge.from, to: edge.to })),
    reservedNodes: new Map(document.reservedNodes.map((entry) => [entry.nodeId, entry.taskId])),
    reservedExits: new Map(document.reservedExits.map((entry) => [tileKey(entry), entry.taskId])),
    incidents: new Map(document.incidents.map((incident) => [incident.id, { ...incident }])),
    objectives: new Map(document.objectives.map((objective) => [objective.id, { ...objective }])),
    tick: document.tick,
    paused: document.paused,
    accumulatorMs: 0,
    nextId: document.nextId,
    orders: document.orders.map((order) => ({ id: order.id, command: order.command })),
    notices: document.notices.map((notice) => ({ ...notice })),
    statusStamp: new Map(),
    noticeLatch: new Set(),
  };
}

function duplicatedId(document: SaveDocument): string | null {
  const lists: [string, string[]][] = [
    ['entity', document.entities.map((entity) => entity.id)],
    ['equipment', document.equipment.map((item) => item.id)],
    ['task', document.tasks.map((task) => task.id)],
    ['incident', document.incidents.map((incident) => incident.id)],
    ['objective', document.objectives.map((objective) => objective.id)],
    ['road', document.roads.map((road) => road.id)],
    ['catalog entry', document.catalog.map((definition) => definition.id)],
    ['order', document.orders.map((order) => order.id)],
    ['notice', document.notices.map((notice) => notice.id)],
  ];
  for (const [label, ids] of lists) {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) return fail(`${label} ${id} is duplicated`);
      seen.add(id);
    }
  }
  return null;
}

function inconsistent(world: World): string | null {
  for (const tile of world.blocked) {
    const [xText, yText] = tile.split(',');
    const x = Number(xText);
    const y = Number(yText);
    if (!inBounds(world.width, world.height, { x, y }))
      return fail(`blocked tile ${tile} is outside the map`);
  }

  const members = new Set<string>();
  for (const memberId of world.team.memberIds) {
    if (members.has(memberId)) return fail(`team member ${memberId} is duplicated`);
    members.add(memberId);
    if (!world.entities.get(memberId)?.responder) return fail(`team member ${memberId} is missing`);
  }
  if (world.team.apparatusId && !world.entities.get(world.team.apparatusId)?.vehicle) {
    return fail(`apparatus ${world.team.apparatusId} is missing`);
  }

  for (const order of world.orders) {
    if (!world.entities.get(order.command.responderId)?.responder) {
      return fail(`order ${order.id} has no responder`);
    }
  }

  for (const edge of world.roadEdges) {
    if (!world.roadNodes.has(edge.from) || !world.roadNodes.has(edge.to)) {
      return fail(`road edge ${edge.from}->${edge.to} is disconnected`);
    }
  }

  for (const entity of world.entities.values()) {
    if (entity.responder && (!entity.position || !entity.movement || !entity.teamMembership)) {
      return fail(`responder ${entity.id} is missing movement`);
    }
    if (entity.vehicle && (!entity.position || !entity.movement)) {
      return fail(`vehicle ${entity.id} is missing movement`);
    }
    if (entity.fire && !entity.position) return fail(`fire ${entity.id} has no position`);
    if (entity.fire && entity.fire.intensity > entity.fire.maxIntensity) {
      return fail(`fire ${entity.id} is above its maximum intensity`);
    }
    if (
      entity.interactable?.objectType === 'door' &&
      entity.interactable.state === 'locked' &&
      entity.position &&
      !world.blocked.has(tileKey(tileOf(entity.position)))
    ) {
      return fail(`locked door ${entity.id} is not blocked`);
    }
    const aboard = entity.responder?.aboardVehicleId;
    if (aboard) {
      const vehicle = world.entities.get(aboard);
      if (!vehicle?.vehicle?.occupants.includes(entity.id)) {
        return fail(`responder ${entity.id} is aboard a vehicle that does not list them`);
      }
    }
    if (!entity.vehicle) continue;
    const vehicle = entity.vehicle;
    if (!world.roadNodes.has(vehicle.nodeId))
      return fail(`vehicle ${entity.id} has an unknown node`);
    if (vehicle.destinationNodeId && !world.roadNodes.has(vehicle.destinationNodeId)) {
      return fail(`vehicle ${entity.id} has an unknown destination`);
    }
    if (vehicle.driverId && !vehicle.occupants.includes(vehicle.driverId)) {
      return fail(`vehicle ${entity.id} driver is not aboard`);
    }
    if (!world.entities.get(vehicle.designatedDriverId)?.responder) {
      return fail(`vehicle ${entity.id} has no designated driver`);
    }
    if (vehicle.occupants.length + vehicle.seatReservations.length > vehicle.capacity) {
      return fail(`vehicle ${entity.id} is over capacity`);
    }
    for (const occupantId of vehicle.occupants) {
      if (world.entities.get(occupantId)?.responder?.aboardVehicleId !== entity.id) {
        return fail(`occupant ${occupantId} is not aboard ${entity.id}`);
      }
    }
    for (const seat of vehicle.seatReservations) {
      if (vehicle.occupants.includes(seat.responderId)) {
        return fail(`responder ${seat.responderId} holds a seat and occupies it`);
      }
      const task = world.tasks.get(seat.taskId);
      if (!task || task.kind !== 'board-vehicle' || task.assigneeId !== seat.responderId) {
        return fail(`seat reservation ${seat.taskId} is not a boarding task`);
      }
      if (task.targetId !== entity.id)
        return fail(`seat reservation ${seat.taskId} targets another vehicle`);
    }
  }

  for (const item of world.equipment.values()) {
    if (!world.catalog.has(item.definitionId))
      return fail(`equipment ${item.id} has an unknown definition`);
    const owned = item.ownerId !== null;
    const stored = item.locationId !== null;
    if (owned === stored)
      return fail(`equipment ${item.id} needs one owner or one storage location`);
    if (item.ownerId && !world.entities.get(item.ownerId)?.responder) {
      return fail(`equipment ${item.id} has an unknown owner`);
    }
    if (item.locationId) {
      const storage = world.entities.get(item.locationId);
      if (storage?.interactable?.objectType !== 'locker' && !storage?.vehicle) {
        return fail(`equipment ${item.id} is not in a locker or vehicle`);
      }
    }
    if (item.reservedByTaskId) {
      const task = world.tasks.get(item.reservedByTaskId);
      if (!task?.reservations.includes(item.id)) {
        return fail(`equipment ${item.id} is reserved by a missing task`);
      }
    }
  }

  for (const task of world.tasks.values()) {
    if (task.parentId && !world.tasks.has(task.parentId))
      return fail(`task ${task.id} has a missing parent`);
    if (task.suspendedByTaskId && !world.tasks.has(task.suspendedByTaskId)) {
      return fail(`task ${task.id} is suspended by a missing task`);
    }
    if ('childTaskId' in task && task.childTaskId) {
      const child = world.tasks.get(task.childTaskId);
      if (!child || child.parentId !== task.id) {
        return fail(`task ${task.id} points at a child that belongs elsewhere`);
      }
    }
    for (const equipmentId of task.reservations) {
      const item = world.equipment.get(equipmentId);
      if (!item || item.reservedByTaskId !== task.id) {
        return fail(`task ${task.id} reservation for ${equipmentId} is not held`);
      }
    }
    if (task.kind === 'drive-vehicle' || task.kind === 'respond') {
      if (!world.entities.get(task.assigneeId)?.vehicle) {
        return fail(`task ${task.id} is not assigned to a vehicle`);
      }
    } else if (task.kind === 'suppress-incident' || task.kind === 'establish-fire-attack') {
      if (!world.incidents.has(task.assigneeId))
        return fail(`task ${task.id} is not assigned to an incident`);
    } else if (!world.entities.get(task.assigneeId)?.responder) {
      return fail(`task ${task.id} is not assigned to a responder`);
    }
    if (task.kind === 'drive-vehicle') {
      if (task.pathIndex >= task.nodeIds.length)
        return fail(`drive ${task.id} has a path index past its route`);
      if (!world.roadNodes.has(task.destinationNodeId))
        return fail(`drive ${task.id} has an unknown destination`);
      if (task.nodeIds.some((nodeId) => !world.roadNodes.has(nodeId))) {
        return fail(`drive ${task.id} leaves the road graph`);
      }
    }
  }

  for (const incident of world.incidents.values()) {
    if (world.entities.has(incident.id)) return fail(`incident ${incident.id} uses an entity id`);
  }
  for (const objective of world.objectives.values()) {
    if (!world.incidents.has(objective.incidentId))
      return fail(`objective ${objective.id} has no incident`);
    if (!world.entities.get(objective.targetId)?.fire)
      return fail(`objective ${objective.id} has no fire`);
  }
  for (const [nodeId, taskId] of world.reservedNodes) {
    if (!world.roadNodes.has(nodeId) || !world.tasks.has(taskId)) {
      return fail(`reserved node ${nodeId} is dangling`);
    }
  }
  for (const [tile, taskId] of world.reservedExits) {
    if (!world.tasks.has(taskId)) return fail(`reserved exit ${tile} is dangling`);
  }
  const hoseEquipment = new Set<string>();
  for (const entity of world.entities.values()) {
    const pump = entity.vehicle?.pump;
    if (pump) {
      if (pump.tank > pump.tankCapacity) return fail(`pump on ${entity.id} is overfilled`);
      if (pump.intakeId && world.entities.get(pump.intakeId)?.hose?.targetId !== entity.id) {
        return fail(`pump on ${entity.id} intake is not connected`);
      }
      for (const discharge of pump.discharges) {
        const hose = world.entities.get(discharge)?.hose;
        if (!hose || hose.kind !== 'attack' || hose.sourceId !== entity.id) {
          return fail(`pump on ${entity.id} discharge ${discharge} is not an attack line`);
        }
      }
    }
    if (entity.hydrant) {
      if (!entity.position) return fail(`hydrant ${entity.id} has no position`);
      if (
        entity.hydrant.connectionId &&
        world.entities.get(entity.hydrant.connectionId)?.hose?.sourceId !== entity.id
      ) {
        return fail(`hydrant ${entity.id} connection does not start there`);
      }
    }
    if (!entity.hose) continue;
    const hose = entity.hose;
    if (hoseEquipment.has(hose.equipmentId)) return fail(`hose ${hose.equipmentId} is duplicated`);
    hoseEquipment.add(hose.equipmentId);
    if (!world.equipment.has(hose.equipmentId)) return fail(`hose ${entity.id} has no equipment`);
    if (entity.id !== `hose-${hose.equipmentId}`) return fail(`hose ${entity.id} has an unstable id`);
    if (hose.operatorId && !world.entities.get(hose.operatorId)?.responder) {
      return fail(`hose ${entity.id} operator is missing`);
    }
    if (hose.kind === 'supply' && hose.state === 'open' && (!hose.sourceId || !hose.targetId)) {
      return fail(`hose ${entity.id} is open without both ends`);
    }
    if (hose.sourceId && !world.entities.has(hose.sourceId)) {
      return fail(`hose ${entity.id} source is missing`);
    }
    if (hose.targetId && !world.entities.has(hose.targetId)) {
      return fail(`hose ${entity.id} target is missing`);
    }
  }
  return null;
}

function fail(detail: string): string {
  return `This save is inconsistent: ${detail}.`;
}

function exportEntity(entity: Entity): SaveEntity {
  return {
    id: entity.id,
    ...(entity.position ? { position: { x: entity.position.x, y: entity.position.y } } : {}),
    ...(entity.movement
      ? {
          movement: {
            speed: entity.movement.speed,
            path: entity.movement.path.map((point) => ({ x: point.x, y: point.y })),
            destination: entity.movement.destination
              ? { x: entity.movement.destination.x, y: entity.movement.destination.y }
              : null,
          },
        }
      : {}),
    ...(entity.responder
      ? {
          responder: {
            name: entity.responder.name,
            ...(entity.responder.aboardVehicleId
              ? { aboardVehicleId: entity.responder.aboardVehicleId }
              : {}),
          },
        }
      : {}),
    ...(entity.teamMembership ? { teamMembership: { teamId: entity.teamMembership.teamId } } : {}),
    ...(entity.interactable
      ? {
          interactable: {
            name: entity.interactable.name,
            objectType: entity.interactable.objectType,
            state: entity.interactable.state,
            ...(entity.interactable.requiredCapability
              ? { requiredCapability: entity.interactable.requiredCapability }
              : {}),
            interactionTiles: entity.interactable.interactionTiles.map((tile) => ({
              x: tile.x,
              y: tile.y,
            })),
          },
        }
      : {}),
    ...(entity.vehicle
      ? {
          vehicle: {
            definitionId: entity.vehicle.definitionId,
            name: entity.vehicle.name,
            heading: entity.vehicle.heading,
            footprint: {
              width: entity.vehicle.footprint.width,
              height: entity.vehicle.footprint.height,
            },
            capacity: entity.vehicle.capacity,
            occupants: [...entity.vehicle.occupants],
            driverId: entity.vehicle.driverId,
            designatedDriverId: entity.vehicle.designatedDriverId,
            status: entity.vehicle.status,
            nodeId: entity.vehicle.nodeId,
            destinationNodeId: entity.vehicle.destinationNodeId,
            pump: entity.vehicle.pump
              ? {
                  state: entity.vehicle.pump.state,
                  pressure: entity.vehicle.pump.pressure,
                  maxDelivery: entity.vehicle.pump.maxDelivery,
                  tankCapacity: entity.vehicle.pump.tankCapacity,
                  tank: entity.vehicle.pump.tank,
                  intakeId: entity.vehicle.pump.intakeId,
                  discharges: [...entity.vehicle.pump.discharges],
                  delivered: entity.vehicle.pump.delivered,
                }
              : null,
            seatReservations: entity.vehicle.seatReservations.map((seat) => ({
              responderId: seat.responderId,
              taskId: seat.taskId,
            })),
          },
        }
      : {}),
    ...(entity.fire
      ? {
          fire: {
            name: entity.fire.name,
            intensity: entity.fire.intensity,
            maxIntensity: entity.fire.maxIntensity,
            fuel: entity.fire.fuel,
            growth: entity.fire.growth,
            fuelUse: entity.fire.fuelUse,
            range: entity.fire.range,
          },
        }
      : {}),
    ...(entity.hydrant
      ? {
          hydrant: {
            name: entity.hydrant.name,
            available: entity.hydrant.available,
            flowCapacity: entity.hydrant.flowCapacity,
            connectionId: entity.hydrant.connectionId,
            interactionTiles: entity.hydrant.interactionTiles.map((tile) => ({
              x: tile.x,
              y: tile.y,
            })),
          },
        }
      : {}),
    ...(entity.hose
      ? {
          hose: {
            kind: entity.hose.kind,
            name: entity.hose.name,
            definitionId: entity.hose.definitionId,
            equipmentId: entity.hose.equipmentId,
            maxLength: entity.hose.maxLength,
            route: entity.hose.route.map((point) => ({ x: point.x, y: point.y })),
            state: entity.hose.state,
            sourceId: entity.hose.sourceId,
            targetId: entity.hose.targetId,
            operatorId: entity.hose.operatorId,
            flow: entity.hose.flow,
          },
        }
      : {}),
  };
}

function importEntity(record: SaveEntity): Entity {
  const entity: Entity = { id: record.id };
  if (record.position) entity.position = { x: record.position.x, y: record.position.y };
  if (record.movement) {
    entity.movement = {
      speed: record.movement.speed,
      path: record.movement.path.map((point) => ({ x: point.x, y: point.y })),
      destination: record.movement.destination
        ? { x: record.movement.destination.x, y: record.movement.destination.y }
        : null,
    };
  }
  if (record.responder) {
    entity.responder = {
      name: record.responder.name,
      ...(record.responder.aboardVehicleId
        ? { aboardVehicleId: record.responder.aboardVehicleId }
        : {}),
    };
  }
  if (record.teamMembership) entity.teamMembership = { teamId: record.teamMembership.teamId };
  if (record.interactable) {
    entity.interactable = {
      name: record.interactable.name,
      objectType: record.interactable.objectType,
      state: record.interactable.state,
      ...(record.interactable.requiredCapability
        ? { requiredCapability: record.interactable.requiredCapability }
        : {}),
      interactionTiles: record.interactable.interactionTiles.map((tile) => ({
        x: tile.x,
        y: tile.y,
      })),
    };
  }
  if (record.vehicle) {
    entity.vehicle = {
      definitionId: record.vehicle.definitionId,
      name: record.vehicle.name,
      heading: record.vehicle.heading,
      footprint: {
        width: record.vehicle.footprint.width,
        height: record.vehicle.footprint.height,
      },
      capacity: record.vehicle.capacity,
      occupants: [...record.vehicle.occupants],
      driverId: record.vehicle.driverId,
      designatedDriverId: record.vehicle.designatedDriverId,
      status: record.vehicle.status,
      nodeId: record.vehicle.nodeId,
      destinationNodeId: record.vehicle.destinationNodeId,
      pump: record.vehicle.pump
        ? {
            state: record.vehicle.pump.state,
            pressure: record.vehicle.pump.pressure,
            maxDelivery: record.vehicle.pump.maxDelivery,
            tankCapacity: record.vehicle.pump.tankCapacity,
            tank: record.vehicle.pump.tank,
            intakeId: record.vehicle.pump.intakeId,
            discharges: [...record.vehicle.pump.discharges],
            delivered: record.vehicle.pump.delivered,
          }
        : null,
      seatReservations: record.vehicle.seatReservations.map((seat) => ({
        responderId: seat.responderId,
        taskId: seat.taskId,
      })),
    };
  }
  if (record.fire) entity.fire = { ...record.fire };
  if (record.hydrant) {
    entity.hydrant = {
      name: record.hydrant.name,
      available: record.hydrant.available,
      flowCapacity: record.hydrant.flowCapacity,
      connectionId: record.hydrant.connectionId,
      interactionTiles: record.hydrant.interactionTiles.map((tile) => ({ x: tile.x, y: tile.y })),
    };
  }
  if (record.hose) {
    entity.hose = {
      kind: record.hose.kind,
      name: record.hose.name,
      definitionId: record.hose.definitionId,
      equipmentId: record.hose.equipmentId,
      maxLength: record.hose.maxLength,
      route: record.hose.route.map((point) => ({ x: point.x, y: point.y })),
      state: record.hose.state,
      sourceId: record.hose.sourceId,
      targetId: record.hose.targetId,
      operatorId: record.hose.operatorId,
      flow: record.hose.flow,
    };
  }
  return entity;
}

function exportTask(task: Task): SaveTask {
  const common = {
    id: task.id,
    state: task.state,
    assigneeId: task.assigneeId,
    source: task.source,
    reservations: [...task.reservations],
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
      step: 'interact',
      progressTicks: task.progressTicks,
      durationTicks: task.durationTicks,
    };
  }
  const activity = {
    ...common,
    targetId: task.targetId,
    step: task.step,
    progressTicks: task.progressTicks,
    durationTicks: task.durationTicks,
    ...(task.childTaskId ? { childTaskId: task.childTaskId } : {}),
    ...(task.approachTile
      ? { approachTile: { x: task.approachTile.x, y: task.approachTile.y } }
      : {}),
  };
  if (task.kind === 'retrieve-equipment') {
    return {
      ...activity,
      kind: 'retrieve-equipment',
      definitionId: task.definitionId,
      ...(task.equipmentId ? { equipmentId: task.equipmentId } : {}),
    };
  }
  if (task.kind === 'drive-vehicle') {
    return {
      ...activity,
      kind: 'drive-vehicle',
      destinationNodeId: task.destinationNodeId,
      nodeIds: [...task.nodeIds],
      pathIndex: task.pathIndex,
    };
  }
  if (task.kind === 'respond') {
    return {
      ...activity,
      kind: 'respond',
      destinationNodeId: task.destinationNodeId,
      disembark: task.disembark,
    };
  }
  if (task.kind === 'suppress-fire') {
    return {
      ...activity,
      kind: 'suppress-fire',
      ...(task.equipmentId ? { equipmentId: task.equipmentId } : {}),
    };
  }
  if (isWaterTask(task)) {
    return {
      ...activity,
      kind: task.kind,
      ...waterFields(task),
    };
  }
  return { ...activity, kind: task.kind };
}

function importTask(task: SaveTask): Task {
  if (task.kind === 'move') {
    return {
      ...copyCommon(task),
      kind: 'move',
      destination: { x: task.destination.x, y: task.destination.y },
    };
  }
  if (task.kind === 'interact') {
    return {
      ...copyCommon(task),
      kind: 'interact',
      targetId: task.targetId,
      action: task.action,
      step: 'interact',
      progressTicks: task.progressTicks,
      durationTicks: task.durationTicks,
    };
  }
  const activity = {
    ...copyCommon(task),
    targetId: task.targetId,
    step: task.step,
    progressTicks: task.progressTicks,
    durationTicks: task.durationTicks,
    ...(task.childTaskId ? { childTaskId: task.childTaskId } : {}),
    ...(task.approachTile
      ? { approachTile: { x: task.approachTile.x, y: task.approachTile.y } }
      : {}),
  };
  if (task.kind === 'retrieve-equipment') {
    return {
      ...activity,
      kind: 'retrieve-equipment',
      definitionId: task.definitionId,
      ...(task.equipmentId ? { equipmentId: task.equipmentId } : {}),
    };
  }
  if (task.kind === 'drive-vehicle') {
    return {
      ...activity,
      kind: 'drive-vehicle',
      destinationNodeId: task.destinationNodeId,
      nodeIds: [...task.nodeIds],
      pathIndex: task.pathIndex,
    };
  }
  if (task.kind === 'respond') {
    return {
      ...activity,
      kind: 'respond',
      destinationNodeId: task.destinationNodeId,
      disembark: task.disembark,
    };
  }
  if (task.kind === 'suppress-fire') {
    return {
      ...activity,
      kind: 'suppress-fire',
      ...(task.equipmentId ? { equipmentId: task.equipmentId } : {}),
    };
  }
  if (isWaterTask(task)) {
    return {
      ...activity,
      kind: task.kind,
      ...waterFields(task),
    };
  }
  return { ...activity, kind: task.kind };
}

function waterFields(task: WaterTask): Pick<WaterTask, 'equipmentId' | 'vehicleId' | 'hydrantId' | 'hoseEntityId' | 'destination' | 'role'> {
  return {
    ...(task.equipmentId ? { equipmentId: task.equipmentId } : {}),
    ...(task.vehicleId ? { vehicleId: task.vehicleId } : {}),
    ...(task.hydrantId ? { hydrantId: task.hydrantId } : {}),
    ...(task.hoseEntityId ? { hoseEntityId: task.hoseEntityId } : {}),
    ...(task.destination ? { destination: { x: task.destination.x, y: task.destination.y } } : {}),
    ...(task.role ? { role: task.role } : {}),
  };
}

function copyCommon(
  task: SaveTask,
): Pick<
  Task,
  | 'id'
  | 'state'
  | 'assigneeId'
  | 'source'
  | 'reservations'
  | 'groupId'
  | 'suspendedByTaskId'
  | 'failureReason'
  | 'parentId'
> {
  return {
    id: task.id,
    state: task.state,
    assigneeId: task.assigneeId,
    source: task.source,
    reservations: [...task.reservations],
    ...(task.groupId ? { groupId: task.groupId } : {}),
    ...(task.suspendedByTaskId ? { suspendedByTaskId: task.suspendedByTaskId } : {}),
    ...(task.failureReason ? { failureReason: task.failureReason } : {}),
    ...(task.parentId ? { parentId: task.parentId } : {}),
  };
}
