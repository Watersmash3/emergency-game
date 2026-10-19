export interface EquipmentDefinitionRecord {
  id: string;
  name: string;
  capabilities: string[];
  agent: number | null;
  suppression: number;
  maxLength: number | null;
}

export interface EquipmentInstance {
  id: string;
  definitionId: string;
  ownerId: string | null;
  locationId: string | null;
  reservedByTaskId: string | null;
  agent: number | null;
}
