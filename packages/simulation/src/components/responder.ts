export interface Responder {
  name: string;
  /** Set while this responder occupies a vehicle seat. Pedestrian commands are rejected. */
  aboardVehicleId?: string;
}
