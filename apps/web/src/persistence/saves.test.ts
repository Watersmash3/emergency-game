import type { SaveDocument } from '@emergency/protocol';
import { describe, expect, it } from 'vitest';

import {
  AUTOSAVE_ID,
  PREVIOUS_AUTOSAVE_ID,
  createMemorySaveStore,
  describeStorageError,
  listSaves,
  writeAutosave,
  writeManualSave,
} from './saves.ts';

function document(tick: number): SaveDocument {
  return { schemaVersion: 2, scenarioId: 'training-yard', tick } as unknown as SaveDocument;
}

describe('save storage', () => {
  it('keeps manual saves when autosave rotates a recovery copy', async () => {
    const store = createMemorySaveStore();
    const manual = await writeManualSave('Hayes suppressing', document(40), store);
    await writeAutosave(document(100), store);
    await writeAutosave(document(200), store);

    const saves = await listSaves(store);
    expect(saves.map((save) => save.id)).toEqual([manual.id, AUTOSAVE_ID, PREVIOUS_AUTOSAVE_ID]);
    expect(saves[0]?.name).toBe('Hayes suppressing');
    expect(saves[1]?.tick).toBe(200);
    expect(saves[2]?.name).toBe('Previous recovery');
    expect(saves[2]?.tick).toBe(100);
  });

  it('describes a full or missing browser store', () => {
    expect(describeStorageError(new DOMException('full', 'QuotaExceededError'))).toBe(
      'Browser storage is full. Delete a save and try again.',
    );
    expect(describeStorageError(new Error('failed'))).toBe('Browser storage is unavailable.');
  });
});
