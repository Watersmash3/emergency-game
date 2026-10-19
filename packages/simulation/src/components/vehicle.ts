export interface VehicleFootprint {
  width: number;
  height: number;
}

export interface SeatReservation {
  responderId: string;
  taskId: string;
}

export type VehicleStatus = 'idle' | 'boarding' | 'moving';

export interface Vehicle {
  definitionId: string;
  name: string;
  heading: number;
  footprint: VehicleFootprint;
  capacity: number;
  occupants: string[];
  driverId: string | null;
  designatedDriverId: string;
  status: VehicleStatus;
  nodeId: string;
  destinationNodeId: string | null;
  seatReservations: SeatReservation[];
}
