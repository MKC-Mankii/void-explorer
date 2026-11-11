import { Simulation, SaveData } from './simulation';
import { UNIVERSE } from './universe';

export const SAVE_KEY = 'void-explorer-save-v1';
export const RECOVERY_KEY = `${SAVE_KEY}-recovery`;
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;

/** Synchronous localStorage writes are atomic per key. Preserve the original BEFORE replacement. */
export class SaveStorage {
  readonly issues: string[] = [];
  backupKey: string | null = null;
  private observed: string | null = null;
  private preserve = false;
  private blocked = false;
  constructor(private readonly storage: () => StorageAccess = () => localStorage) {}

  load(sim: Simulation) {
    let value: unknown;
    try {
      this.observed = this.storage().getItem(SAVE_KEY);
    } catch {
      this.blocked = true;
      this.issues.push('storage-read-failed');
      return false;
    }
    if (this.observed === null) return false;
    try {
      value = JSON.parse(this.observed);
    } catch {
      this.preserve = true;
      this.issues.push('invalid-json');
      return false;
    }
    if (value && typeof value === 'object' && 'version' in value && value.version === 1) {
      const s = value as SaveData;
      if (
        Number.isInteger(s.system) &&
        UNIVERSE[s.system] &&
        s.target !== undefined &&
        (!Number.isInteger(s.target) || !UNIVERSE[s.system].planets[s.target])
      ) {
        value = { ...s, target: 0 };
        this.issues.push('default:target');
      }
    }
    if (sim.restore(value)) {
      this.issues.push(...sim.restoreIssues);
      this.preserve = this.issues.length > 0;
      return true;
    }
    this.preserve = true;
    this.issues.push('invalid-save-safe-start');
    // Only the known v1 format has a defined progress interpretation. Future formats
    // must remain available for their own application, even if a backup could be made.
    if (value && typeof value === 'object' && 'version' in value) {
      if (typeof value.version === 'number' && value.version > 1) {
        this.blocked = true;
        this.issues.push('future-version-write-blocked');
      } else if (value.version === 1) {
        const s = value as SaveData;
        const fresh = new Simulation();
        if (Number.isInteger(s.system) && UNIVERSE[s.system]) fresh.jump(s.system);
        // Reuse the same discovery sanitization as a normal restore. Invalid pose
        // data never makes otherwise valid scanned/landed/sampled progress disappear.
        fresh.restore({ ...fresh.save(), discoveries: s.discoveries, playTime: s.playTime });
        sim.restore(fresh.save());
        this.issues.push('known-progress-recovered');
      }
    }
    return false;
  }

  save(sim: Simulation): boolean {
    if (this.blocked) return false;
    try {
      const storage = this.storage();
      // Do not silently overwrite a different tab's newer save.
      if (storage.getItem(SAVE_KEY) !== this.observed) {
        this.blocked = true;
        this.issues.push('save-changed-in-another-tab');
        return false;
      }
      if (this.preserve && this.observed !== null) {
        this.backupKey = null;
        // Bounded slots preserve earlier failures too. If full or quota limited,
        // leave the primary untouched and report the existing save failure UI.
        for (let i = 0; i < 20; i++) {
          const key = i === 0 ? RECOVERY_KEY : `${RECOVERY_KEY}-${i}`;
          const existing = storage.getItem(key);
          if (existing === this.observed || existing === null) {
            if (existing === null) storage.setItem(key, this.observed);
            if (storage.getItem(key) !== this.observed) return false;
            this.backupKey = key;
            break;
          }
        }
        if (!this.backupKey) return false;
      }
      const next = JSON.stringify(sim.save());
      storage.setItem(SAVE_KEY, next);
      this.observed = next;
      this.preserve = false;
      return true;
    } catch {
      return false;
    }
  }
}
