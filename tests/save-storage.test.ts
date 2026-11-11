import { describe, expect, it } from 'vitest';
import { Simulation, NO_INPUT } from '../src/simulation';
import { RECOVERY_KEY, SAVE_KEY, SaveStorage } from '../src/save-storage';

function memory(raw?: string) {
  const values = new Map<string, string>(raw === undefined ? [] : [[SAVE_KEY, raw]]);
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
function progress() {
  const sim = new Simulation();
  sim.scan();
  return sim.save();
}
function reload(storage: ReturnType<typeof memory>) {
  const sim = new Simulation();
  const store = new SaveStorage(() => storage);
  const continued = store.load(sim);
  return { sim, store, continued };
}

describe('save recovery and atomic preservation', () => {
  it('roundtrips current saves and legitimate early v1 saves without losing discoveries', () => {
    for (const legacy of [false, true]) {
      const saved = progress();
      if (legacy) {
        delete saved.target;
        delete saved.velocity;
        delete saved.speed;
      }
      const storage = memory(JSON.stringify(saved));
      const { sim, store, continued } = reload(storage);
      expect(continued).toBe(true);
      expect(sim.score).toBe(100);
      expect(store.save(sim)).toBe(true);
      const second = reload(storage);
      expect(second.continued).toBe(true);
      expect(second.sim.score).toBe(100);
      expect(second.store.issues).toEqual([]);
      expect(storage.getItem(RECOVERY_KEY) !== null).toBe(legacy);
    }
  });
  it.each(['', '{broken', 'null', '[]', 'true', '"bad"', '{}'])(
    'preserves raw invalid data %j before replacement',
    (raw) => {
      const storage = memory(raw);
      const { sim, store, continued } = reload(storage);
      expect(continued).toBe(false);
      sim.tick(1 / 60, NO_INPUT);
      expect(Number.isFinite(sim.height)).toBe(true);
      expect(storage.getItem(SAVE_KEY)).toBe(raw);
      expect(store.save(sim)).toBe(true);
      expect(storage.getItem(RECOVERY_KEY)).toBe(raw);
      expect(reload(storage).continued).toBe(true);
    },
  );
  it.each([
    { system: 99 },
    { system: '0' },
    { position: [1e99, 0, 0] },
    { position: [null, 0, 0] },
    { rotation: [0, 0, 0, 0] },
    { mode: 'walking', landedPlanet: 'unknown' },
    { speed: 1e9 },
    { velocity: [9999999, 0, 0] },
  ])('recovers known discoveries even when unsafe pose cannot be restored: %j', (patch) => {
    const raw = JSON.stringify({ ...progress(), ...patch });
    const storage = memory(raw);
    const { sim, store } = reload(storage);
    expect(sim.score).toBe(100);
    expect(sim.mode).toBe('flight');
    expect(store.save(sim)).toBe(true);
    expect(storage.getItem(RECOVERY_KEY)).toBe(raw);
    expect(reload(storage).sim.score).toBe(100);
  });
  it('defaults optional fields and invalid target deterministically; keeps extra data in original', () => {
    const saved = { ...progress(), target: -1, playTime: -50, extra: 'old plugin' } as Record<
      string,
      unknown
    >;
    delete saved.shipPosition;
    delete saved.shipRotation;
    const raw = JSON.stringify(saved),
      storage = memory(raw);
    const { sim, store, continued } = reload(storage);
    expect(continued).toBe(true);
    expect(sim.target).toBe(0);
    expect(sim.playTime).toBe(0);
    expect(sim.score).toBe(100);
    expect(store.save(sim)).toBe(true);
    expect(storage.getItem(RECOVERY_KEY)).toBe(raw);
  });
  it('rejects NaN and Infinity without partially mutating a live simulation', () => {
    for (const bad of [NaN, Infinity, -Infinity, 1e99, -1e99]) {
      const sim = new Simulation();
      sim.scan();
      const before = JSON.stringify(sim.save());
      expect(sim.restore({ ...sim.save(), position: [bad, 0, 0] })).toBe(false);
      expect(JSON.stringify(sim.save())).toBe(before);
    }
  });
  it('does not guess an undocumented versionless format or downgrade a future version', () => {
    const s: Record<string, unknown> = { ...progress() };
    delete s.version;
    expect(new Simulation().restore(s)).toBe(false);
    const raw = JSON.stringify({ ...progress(), version: 2 });
    const storage = memory(raw),
      { sim, store } = reload(storage);
    expect(store.save(sim)).toBe(false);
    expect(storage.getItem(SAVE_KEY)).toBe(raw);
    expect(reload(storage).continued).toBe(false);
  });
  it('keeps both original and prior backup on repeated failures', () => {
    const storage = memory('{first');
    let loaded = reload(storage);
    expect(loaded.store.save(loaded.sim)).toBe(true);
    storage.setItem(SAVE_KEY, '{second');
    loaded = reload(storage);
    expect(loaded.store.save(loaded.sim)).toBe(true);
    expect(storage.getItem(RECOVERY_KEY)).toBe('{first');
    expect(storage.getItem(`${RECOVERY_KEY}-1`)).toBe('{second');
  });
  it('blocks replacement when backup quota is unavailable, then safely retries', () => {
    const storage = memory('{broken');
    const set = storage.setItem;
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const { sim, store } = reload(storage);
    expect(store.save(sim)).toBe(false);
    expect(storage.getItem(SAVE_KEY)).toBe('{broken');
    storage.setItem = set;
    expect(store.save(sim)).toBe(true);
    expect(storage.getItem(RECOVERY_KEY)).toBe('{broken');
  });
  it('survives an interruption after backup and before primary write', () => {
    const storage = memory('{broken'),
      set = storage.setItem;
    storage.setItem = (key, value) => {
      if (key === SAVE_KEY) throw new Error('interrupted');
      set(key, value);
    };
    let loaded = reload(storage);
    expect(loaded.store.save(loaded.sim)).toBe(false);
    expect(storage.getItem(SAVE_KEY)).toBe('{broken');
    expect(storage.getItem(RECOVERY_KEY)).toBe('{broken');
    storage.setItem = set;
    loaded = reload(storage);
    expect(loaded.store.save(loaded.sim)).toBe(true);
    expect(reload(storage).continued).toBe(true);
  });
  it('blocks writes after read failure or concurrent replacement', () => {
    const sim = new Simulation();
    const unavailable = new SaveStorage(() => {
      throw new Error('SecurityError');
    });
    expect(unavailable.load(sim)).toBe(false);
    expect(unavailable.save(sim)).toBe(false);
    const storage = memory(),
      { store } = reload(storage);
    storage.setItem(SAVE_KEY, 'newer-tab');
    expect(store.save(sim)).toBe(false);
    expect(storage.getItem(SAVE_KEY)).toBe('newer-tab');
  });
});
