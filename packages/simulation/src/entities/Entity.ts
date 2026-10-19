import type { Interactable } from '../components/interactable.ts';
import type { Movement } from '../components/movement.ts';
import type { Position } from '../components/position.ts';
import type { Responder } from '../components/responder.ts';
import type { TeamMembership } from '../components/teamMembership.ts';
import type { Vehicle } from '../components/vehicle.ts';
import type { Fire } from '../components/fire.ts';

/** A stable id plus the components the entity currently has. */
export interface Entity {
  id: string;
  position?: Position;
  movement?: Movement;
  responder?: Responder;
  teamMembership?: TeamMembership;
  interactable?: Interactable;
  vehicle?: Vehicle;
  fire?: Fire;
}
