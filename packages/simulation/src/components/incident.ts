export interface IncidentRecord {
  id: string;
  name: string;
  state: 'active' | 'resolved';
}

export interface ObjectiveRecord {
  id: string;
  incidentId: string;
  kind: 'suppress-fire' | 'overhaul-room';
  targetId: string;
  state: 'open' | 'satisfied';
}
