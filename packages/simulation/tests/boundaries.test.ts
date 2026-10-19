import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { simulationSnapshotSchema } from '@emergency/protocol';

import { createSimulation } from '../src/index.ts';
import { makeScenario } from './helpers.ts';

describe('simulation boundaries', () => {
  it('round-trips a snapshot through JSON and the protocol schema', () => {
    const sim = createSimulation(makeScenario());
    sim.apply({ type: 'move-team', teamId: 'engine-1', destination: { x: 4, y: 3 } });
    sim.tick();

    const snapshot = sim.getSnapshot();
    const cloned = JSON.parse(JSON.stringify(snapshot)) as unknown;

    expect(cloned).toEqual(snapshot);
    expect(simulationSnapshotSchema.parse(cloned)).toEqual(snapshot);
  });

  it('keeps rendering libraries out of the simulation package', () => {
    const packageJson = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies?: Record<string, string> };

    expect(packageJson.dependencies).not.toHaveProperty('phaser');
    expect(packageJson.dependencies).not.toHaveProperty('react');
    expect(packageJson.dependencies).not.toHaveProperty('react-dom');

    const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));
    const sources = walk(sourceRoot).filter((file) => file.endsWith('.ts'));
    const combined = sources.map((file) => readFileSync(file, 'utf8')).join('\n');

    expect(combined).not.toMatch(/from ['"]phaser['"]/);
    expect(combined).not.toMatch(/from ['"]react['"]/);
    expect(combined).not.toMatch(/from ['"]react-dom['"]/);
  });
});

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}
