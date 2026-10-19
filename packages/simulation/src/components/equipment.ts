export interface EquipmentDefinitionRecord {
  id: string;
  name: string;
  capabilities: string[];
}

export interface EquipmentInstance {
  id: string;
  definitionId: string;
  ownerId: string | null;
  locationId: string | null;
  reservedByTaskId: string | null;
}
