import { Vector3, Quaternion, Matrix4, MathUtils, Euler } from 'three';
import {
  SystemData,
  PlanetData,
  UNIVERSE,
  altitude,
  surfaceRadius,
  terrainHeight,
} from './universe';
export type Mode = 'flight' | 'landing' | 'landed' | 'walking' | 'takeoff';
export interface FlightInput {
  throttle: number;
  strafe: number;
  lift: number;
  pitch: number;
  yaw: number;
  roll: number;
  boost: boolean;
  brake: boolean;
}
export const NO_INPUT: FlightInput = {
  throttle: 0,
  strafe: 0,
  lift: 0,
  pitch: 0,
  yaw: 0,
  roll: 0,
  boost: false,
  brake: false,
};
const UP = new Vector3(0, 1, 0),
  FORWARD = new Vector3(0, 0, -1);
export interface SaveData {
  version: 1;
  system: number;
  position: number[];
  rotation: number[];
  mode: Mode;
  landedPlanet: string | null;
  shipPosition: number[];
  shipRotation: number[];
  discoveries: Record<string, { scan: boolean; land: boolean; sample: boolean }>;
  playTime: number;
}
export class Simulation {
  system: SystemData = UNIVERSE[0];
  position = new Vector3(0, 700, 5200);
  rotation = new Quaternion();
  velocity = new Vector3();
  shipPosition = new Vector3();
  shipRotation = new Quaternion();
  mode: Mode = 'flight';
  speed = 0;
  target = 0;
  landedPlanet: PlanetData | null = null;
  discoveries: SaveData['discoveries'] = {};
  playTime = 0;
  transition = 0;
  private startPos = new Vector3();
  private endPos = new Vector3();
  private startRot = new Quaternion();
  private endRot = new Quaternion();
  private walkVertical = 0;
  onEvent: (text: string) => void = () => {};
  constructor() {
    this.lookAt(new Vector3(-950, 150, 0));
    this.shipPosition.copy(this.position);
    this.shipRotation.copy(this.rotation);
  }
  get selected() {
    return this.system.planets[this.target];
  }
  get nearest() {
    let p = this.system.planets[0],
      min = Infinity;
    for (const candidate of this.system.planets) {
      const d = altitude(candidate, this.position);
      if (d < min) {
        min = d;
        p = candidate;
      }
    }
    return p;
  }
  get height() {
    return altitude(this.nearest, this.position);
  }
  get forward() {
    return FORWARD.clone().applyQuaternion(this.rotation);
  }
  lookAt(target: Vector3, up = UP) {
    this.rotation.setFromRotationMatrix(new Matrix4().lookAt(this.position, target, up));
  }
  tick(dt: number, input: FlightInput) {
    dt = Math.min(dt, 0.05);
    this.playTime += dt;
    if (this.mode === 'landing' || this.mode === 'takeoff') {
      this.transition += dt;
      const duration = this.mode === 'landing' ? 13 : 5;
      const t = MathUtils.clamp(this.transition / duration, 0, 1),
        ease = t * t * (3 - 2 * t);
      this.position.lerpVectors(this.startPos, this.endPos, ease);
      this.rotation.slerpQuaternions(this.startRot, this.endRot, MathUtils.smoothstep(t, 0, 0.75));
      this.speed = this.position.distanceTo(this.endPos) / duration;
      this.velocity.set(0, 0, 0);
      if (t === 1) {
        if (this.mode === 'landing') {
          this.mode = 'landed';
          this.record(this.landedPlanet!, 'land');
          this.onEvent('着陆完成 · 按 E 离舱，探索这片世界');
        } else {
          this.mode = 'flight';
          this.speed = 12;
          this.onEvent('起飞完成 · 星海在前方');
        }
        this.speed = 0;
      }
      this.shipPosition.copy(this.position);
      this.shipRotation.copy(this.rotation);
      return;
    }
    if (this.mode === 'landed') {
      this.speed = 0;
      return;
    }
    if (this.mode === 'walking') {
      this.walk(dt, input);
      return;
    }
    const near = this.nearest,
      h = altitude(near, this.position),
      up = this.position.clone().sub(near.position).normalize();
    // Mouse and keys rotate in the craft's local frame, preserving six-axis flight.
    this.rotation
      .multiply(
        new Quaternion().setFromEuler(
          new Euler(input.pitch * dt, input.yaw * dt, input.roll * dt, 'YXZ'),
        ),
      )
      .normalize();
    const max =
      h < near.radius * 0.06 ? 24 : h < near.radius * 0.3 ? 100 : input.boost ? 1100 : 320;
    if (input.throttle !== 0)
      this.speed = MathUtils.clamp(
        this.speed + input.throttle * (input.boost ? 210 : 85) * dt,
        -35,
        max,
      );
    else if (Math.abs(this.speed) > max)
      this.speed = MathUtils.damp(this.speed, Math.sign(this.speed) * max, 2, dt);
    if (input.brake) this.speed = MathUtils.damp(this.speed, 0, 7, dt);
    const forward = this.forward,
      right = new Vector3(1, 0, 0).applyQuaternion(this.rotation),
      localUp = UP.clone().applyQuaternion(this.rotation);
    const desired = forward
      .multiplyScalar(this.speed)
      .addScaledVector(right, input.strafe * (h < 100 ? 6 : 55))
      .addScaledVector(localUp, input.lift * (h < 100 ? 10 : 55));
    this.velocity.lerp(desired, 1 - Math.exp(-dt * 3));
    this.position.addScaledVector(this.velocity, dt);
    for (const p of this.system.planets) {
      const d = this.position.clone().sub(p.position),
        floor = surfaceRadius(p, d.clone().normalize()) + 0.8;
      if (d.length() < floor) {
        const impact = this.velocity.length();
        this.position.copy(p.position).addScaledVector(d.normalize(), floor);
        this.speed = 0;
        this.velocity.set(0, 0, 0);
        if (impact > 15) this.onEvent('近地防撞已介入 · 按 L 启动着陆程序');
      }
    }
    const fromStar = this.position.clone().sub(this.system.star);
    if (fromStar.length() < 2300) {
      this.position.copy(this.system.star).addScaledVector(fromStar.normalize(), 2310);
      this.speed = 0;
      this.velocity.set(0, 0, 0);
      this.onEvent('恒星高温区 · 防护系统已阻止继续接近');
    }
    // A little atmospheric leveling is optional; no forced horizon in space.
    if (h < near.radius * 0.15 && input.roll === 0) {
      const craftUp = UP.clone().applyQuaternion(this.rotation);
      const correction = new Quaternion().setFromUnitVectors(craftUp, up);
      this.rotation.premultiply(new Quaternion().slerp(correction, dt * 0.09));
    }
    this.shipPosition.copy(this.position);
    this.shipRotation.copy(this.rotation);
  }
  private walk(dt: number, input: FlightInput) {
    const p = this.landedPlanet!;
    const up = this.position.clone().sub(p.position).normalize();
    // Surface yaw is about the planet normal. Pitch affects the camera only (managed by Game).
    this.rotation.premultiply(new Quaternion().setFromAxisAngle(up, input.yaw * dt));
    const f = this.forward.projectOnPlane(up).normalize(),
      r = new Vector3().crossVectors(f, up).normalize();
    const movement = f.multiplyScalar(input.throttle).addScaledVector(r, input.strafe);
    if (movement.lengthSq() > 1) movement.normalize();
    const distance = (input.boost ? 1.1 : 0.55) * dt;
    const dir = this.position
      .clone()
      .sub(p.position)
      .addScaledVector(movement, distance)
      .normalize();
    const prevUp = up.clone();
    const nextRadius = surfaceRadius(p, dir) + 0.18;
    const h = terrainHeight(p, dir);
    if (p.ocean && h < -0.1) {
      this.onEvent('深水区域 · 宇航服已限制前进');
      return;
    }
    this.position.copy(p.position).addScaledVector(dir, nextRadius + this.walkVertical);
    this.rotation.premultiply(new Quaternion().setFromUnitVectors(prevUp, dir));
    this.speed = movement.length() * (input.boost ? 1.1 : 0.55);
  }
  requestLanding() {
    if (this.mode !== 'flight') return false;
    const p = this.nearest;
    if (this.height > p.radius * 2.5) {
      this.onEvent('请先接近行星 · 进入 2.5 倍半径范围后可着陆');
      return false;
    }
    if (Math.abs(this.speed) > 400) {
      this.onEvent('速度过高 · 松开推进并按 X 制动后着陆');
      return false;
    }
    this.landedPlanet = p;
    let dir = this.position.clone().sub(p.position).normalize();
    if (p.ocean && terrainHeight(p, dir) < 3) {
      const east = new Vector3().crossVectors(dir, UP).normalize();
      if (east.lengthSq() < 0.1) east.set(1, 0, 0);
      const north = new Vector3().crossVectors(dir, east);
      let best = terrainHeight(p, dir),
        bestDir = dir;
      for (let i = 0; i < 120; i++) {
        const angle = i * 2.399963,
          r = 0.035 + Math.sqrt(i / 120) * 0.24;
        const test = dir
          .clone()
          .addScaledVector(east, Math.cos(angle) * r)
          .addScaledVector(north, Math.sin(angle) * r)
          .normalize();
        const h = terrainHeight(p, test);
        if (h > best) {
          best = h;
          bestDir = test;
        }
        if (h > 4) {
          bestDir = test;
          break;
        }
      }
      dir = bestDir;
      if (best < 0 && terrainHeight(p, dir) < 0) {
        this.onEvent('当前下方为海洋 · 请寻找陆地再着陆');
        return false;
      }
    }
    this.endPos.copy(p.position).addScaledVector(dir, surfaceRadius(p, dir) + 0.61);
    let tangent = this.forward.projectOnPlane(dir).normalize();
    if (tangent.lengthSq() < 0.01)
      tangent = new Vector3().crossVectors(dir, new Vector3(1, 0, 0)).normalize();
    this.endRot.setFromRotationMatrix(
      new Matrix4().lookAt(this.endPos, this.endPos.clone().add(tangent), dir),
    );
    this.begin('landing');
    this.onEvent('着陆引导启动 · 正在下降至安全地表');
    return true;
  }
  private begin(mode: 'landing' | 'takeoff') {
    this.mode = mode;
    this.transition = 0;
    this.startPos.copy(this.position);
    this.startRot.copy(this.rotation);
    this.speed = 0;
    this.velocity.set(0, 0, 0);
  }
  interact() {
    if (this.mode === 'landed') {
      this.mode = 'walking';
      const p = this.landedPlanet!,
        right = new Vector3(1, 0, 0).applyQuaternion(this.rotation);
      const dir = this.position.clone().sub(p.position).addScaledVector(right, 4.5).normalize();
      this.position.copy(p.position).addScaledVector(dir, surfaceRadius(p, dir) + 0.18);
      this.lookAt(this.shipPosition, dir);
      this.onEvent('离舱完成 · WASD 步行 · F 采样 · 靠近飞船按 E 登舱');
      return true;
    }
    if (this.mode === 'walking') {
      if (this.position.distanceTo(this.shipPosition) > 7) {
        this.onEvent('请返回飞船附近（70 m 内）再登舱');
        return false;
      }
      this.position.copy(this.shipPosition);
      this.rotation.copy(this.shipRotation);
      this.mode = 'landed';
      this.onEvent('欢迎回来，指挥官 · 按 Space 起飞');
      return true;
    }
    return false;
  }
  takeoff() {
    if (this.mode !== 'landed') return false;
    const p = this.landedPlanet!,
      up = this.position.clone().sub(p.position).normalize();
    this.endPos.copy(this.position).addScaledVector(up, 90);
    const forward = this.forward
      .projectOnPlane(up)
      .normalize()
      .multiplyScalar(0.7)
      .addScaledVector(up, 0.7)
      .normalize();
    this.endRot.setFromRotationMatrix(
      new Matrix4().lookAt(this.endPos, this.endPos.clone().add(forward), up),
    );
    this.begin('takeoff');
    this.onEvent('起飞序列启动 · 正在爬升');
    return true;
  }
  scan() {
    const p = this.mode === 'walking' ? this.landedPlanet! : this.nearest;
    const type = this.mode === 'walking' ? 'sample' : 'scan';
    if (this.mode !== 'walking' && altitude(p, this.position) > p.radius * 3) {
      this.onEvent('信号太弱 · 靠近行星后按 F 扫描');
      return false;
    }
    if (this.discoveries[p.id]?.[type]) {
      this.onEvent(
        type === 'sample'
          ? '本地样本已收录 · 可前往下一颗行星'
          : '该行星扫描已完成 · 按 M 查看探索日志',
      );
      return false;
    }
    this.record(p, type);
    this.onEvent(
      type === 'sample'
        ? `地表样本已收录 · ${p.epithet} · +250 探索点`
        : `扫描完成 · ${p.name} · +100 探索点`,
    );
    return true;
  }
  private record(p: PlanetData, type: 'scan' | 'land' | 'sample') {
    this.discoveries[p.id] ??= { scan: false, land: false, sample: false };
    this.discoveries[p.id][type] = true;
  }
  jump(id: number) {
    if (!Number.isInteger(id) || !UNIVERSE[id]) return false;
    if (this.mode !== 'flight') {
      this.onEvent('请先返回飞船并起飞，再进行星系跃迁');
      return false;
    }
    if (id === this.system.id) {
      this.onEvent('你已位于这个星系');
      return false;
    }
    this.system = UNIVERSE[id];
    this.target = 0;
    this.position.copy(this.system.planets[0].position).add(new Vector3(0, 700, 5200));
    this.lookAt(this.system.planets[0].position);
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.landedPlanet = null;
    this.shipPosition.copy(this.position);
    this.shipRotation.copy(this.rotation);
    this.onEvent(`跃迁完成 · 欢迎来到${this.system.name}星系`);
    return true;
  }
  navigate(index: number) {
    if (!Number.isInteger(index) || !this.system.planets[index]) return false;
    if (this.mode !== 'flight') return false;
    this.target = index;
    this.lookAt(this.selected.position);
    this.onEvent(`航向已对准 ${this.selected.name} · W 推进，Shift 加速`);
    return true;
  }
  get score() {
    return Object.values(this.discoveries).reduce(
      (n, d) => n + (d.scan ? 100 : 0) + (d.land ? 150 : 0) + (d.sample ? 250 : 0),
      0,
    );
  }
  save(): SaveData {
    return {
      version: 1,
      system: this.system.id,
      position: this.position.toArray(),
      rotation: this.rotation.toArray(),
      mode: this.mode === 'landing' || this.mode === 'takeoff' ? 'flight' : this.mode,
      landedPlanet: this.landedPlanet?.id ?? null,
      shipPosition: this.shipPosition.toArray(),
      shipRotation: this.shipRotation.toArray(),
      discoveries: this.discoveries,
      playTime: this.playTime,
    };
  }
  restore(value: unknown) {
    try {
      const s = value as SaveData;
      const modes: Mode[] = ['flight', 'landed', 'walking'];
      if (!s || s.version !== 1 || !UNIVERSE[s.system] || !modes.includes(s.mode)) return false;
      const finite = (a: unknown, n: number): a is number[] =>
        Array.isArray(a) &&
        a.length === n &&
        a.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e7);
      if (
        !finite(s.position, 3) ||
        !finite(s.rotation, 4) ||
        !finite(s.shipPosition, 3) ||
        !finite(s.shipRotation, 4)
      )
        return false;
      const planet = UNIVERSE[s.system].planets.find((p) => p.id === s.landedPlanet) ?? null;
      if (s.mode !== 'flight' && !planet) return false;
      const validIds = new Set(UNIVERSE.flatMap((s) => s.planets.map((p) => p.id)));
      const discoveries: SaveData['discoveries'] = {};
      for (const [id, d] of Object.entries(s.discoveries ?? {})) {
        if (validIds.has(id) && d && typeof d === 'object')
          discoveries[id] = {
            scan: d.scan === true,
            land: d.land === true,
            sample: d.sample === true,
          };
      }
      this.system = UNIVERSE[s.system];
      this.position.fromArray(s.position);
      this.rotation.fromArray(s.rotation).normalize();
      this.mode = s.mode;
      this.shipPosition.fromArray(s.shipPosition);
      this.shipRotation.fromArray(s.shipRotation).normalize();
      this.landedPlanet = planet;
      this.discoveries = discoveries;
      this.playTime = Number.isFinite(s.playTime) ? Math.max(0, s.playTime) : 0;
      return true;
    } catch {
      return false;
    }
  }
}
