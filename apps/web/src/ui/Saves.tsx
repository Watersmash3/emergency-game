import { saveDocumentSchema, saveSchemaMessage } from '@emergency/protocol';
import { useEffect, useState } from 'react';

import {
  deleteSave,
  describeStorageError,
  listSaves,
  writeManualSave,
  type SaveRecord,
} from '../persistence/saves.ts';
import { useGameStore } from '../state/gameStore.ts';
import { exportDocument, restoreDocument } from '../workers/simulationClient.ts';

export function Saves() {
  const revision = useGameStore((state) => state.savesRevision);
  const notice = useGameStore((state) => state.saveNotice);
  const [name, setName] = useState('Manual save');
  const [saves, setSaves] = useState<SaveRecord[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listSaves()
      .then((records) => {
        if (!cancelled) setSaves(records);
      })
      .catch((error: unknown) => {
        if (!cancelled) useGameStore.getState().setSaveNotice(describeStorageError(error));
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);

  async function onSave(): Promise<void> {
    setBusy(true);
    try {
      const document = await exportDocument();
      const record = await writeManualSave(name, document);
      useGameStore.getState().setSaveNotice(`Saved ${record.name}.`);
      useGameStore.getState().bumpSaves();
    } catch (error) {
      useGameStore.getState().setSaveNotice(failureNotice(error));
    } finally {
      setBusy(false);
    }
  }

  async function onLoad(record: SaveRecord): Promise<void> {
    const parsed = saveDocumentSchema.safeParse(record.document);
    if (!parsed.success) {
      useGameStore.getState().setSaveNotice(saveSchemaMessage(record.document));
      return;
    }
    setBusy(true);
    try {
      const result = await restoreDocument(parsed.data);
      useGameStore.getState().setSaveNotice(result.ok ? `Loaded ${record.name}.` : result.message);
    } catch (error) {
      useGameStore.getState().setSaveNotice(failureNotice(error));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(record: SaveRecord): Promise<void> {
    setBusy(true);
    try {
      await deleteSave(record.id);
      useGameStore.getState().setSaveNotice(`Deleted ${record.name}.`);
      useGameStore.getState().bumpSaves();
    } catch (error) {
      useGameStore.getState().setSaveNotice(failureNotice(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="saves">
      <h2>Saves</h2>
      <label>
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <button type="button" onClick={() => void onSave()} disabled={busy}>
        Save
      </button>
      <ul className="roster">
        {saves.map((record) => (
          <li key={record.id}>
            <span>{record.name}</span>
            <small>
              {record.scenarioId} · tick {record.tick} ·{' '}
              {new Date(record.createdAt).toLocaleString()}
            </small>
            <button type="button" onClick={() => void onLoad(record)} disabled={busy}>
              Load
            </button>
            <button type="button" onClick={() => void onDelete(record)} disabled={busy}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      {notice ? (
        <p
          className={noticeLooksFailed(notice) ? 'result error' : 'result'}
          data-save-notice={notice}
        >
          {notice}
        </p>
      ) : null}
    </section>
  );
}

function failureNotice(error: unknown): string {
  if (error instanceof Error && error.message.startsWith('Simulation')) return error.message;
  return describeStorageError(error);
}

function noticeLooksFailed(notice: string): boolean {
  return /invalid|inconsistent|unavailable|full|cannot|failed/i.test(notice);
}
