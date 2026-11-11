import { Vector3, Quaternion, Matrix4, MathUtils, Euler } from 'three';
import { SHIP_LAYOUT, avoidShipHull } from './ship-layout';
import {
  SystemData,
  PlanetData,
  UNIVERSE,
  altitude,
  surfaceRadius,
  terrainHeight,
} from './universe';
import {
  FLIGHT,
  Guidance,
  NavigationStatus,
  approach,
  navigationMetrics,
  routeObstacle,
  flightSpeedLimit,
  arrivalClearance,
} from './navigation';
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
  target?: number;
  velocity?: number[];
  speed?: number;
}
export class Simulation {
  restoreIssues: string[] = [];
  system: SystemData = UNIVERSE[0];
  position = new Vector3(0, 700, 5200);
  rotation = new Quaternion();
  velocity = new Vector3();
  shipPosition = new Vector3();
  shipRotation = new Quaternion();
  mode: Mode = 'flight';
  speed = 0;
  target = 0;
  angularVelocity = new Vector3();
  guidance: Guidance = 'off';
  navigationStatus: NavigationStatus = 'idle';
  blockedBy: string | null = null;
  speedLimit = FLIGHT.normal;
  get navigation() {
    return navigationMetrics(this.position, this.forward, this.velocity, this.selected);
  }

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
          this.speed = 0;
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
    const rotating = Math.abs(input.pitch) + Math.abs(input.yaw) + Math.abs(input.roll) > 0.001;
    const translating = input.throttle !== 0 || input.strafe !== 0 || input.lift !== 0;
    if (
      rotating ||
      input.brake ||
      ((this.guidance === 'cruise' || this.navigationStatus === 'blocked') && translating)
    )
      this.cancelGuidance('manual');
    if (this.guidance !== 'off') {
      const blocked =
        this.guidance === 'cruise'
          ? routeObstacle(this.system, this.position, this.selected)
          : null;
      if (blocked) {
        this.blockedBy = blocked;
        this.cancelGuidance('blocked');
        this.onEvent(`航路被 ${blocked} 遮挡 · 已退出巡航，请先制动并绕行`);
      }
    }
    if (this.guidance !== 'off') {
      const desired = new Quaternion().setFromRotationMatrix(
        new Matrix4().lookAt(
          this.position,
          this.selected.position,
          UP.clone().applyQuaternion(this.rotation),
        ),
      );
      this.rotation.rotateTowards(desired, FLIGHT.guideTurnRate * dt);
      this.angularVelocity.set(0, 0, 0);
      if (this.guidance === 'align' && this.navigation.headingError < 0.3) {
        this.guidance = 'off';
        this.navigationStatus = 'idle';
      }
    } else {
      const response = 1 - Math.exp(-8 * dt);
      this.angularVelocity.lerp(
        new Vector3(
          MathUtils.clamp(input.pitch, -1.4, 1.4),
          MathUtils.clamp(input.yaw, -1.4, 1.4),
          MathUtils.clamp(input.roll, -1.4, 1.4),
        ),
        response,
      );
      this.rotation
        .multiply(
          new Quaternion().setFromEuler(
            new Euler(
              this.angularVelocity.x * dt,
              this.angularVelocity.y * dt,
              this.angularVelocity.z * dt,
              'YXZ',
            ),
          ),
        )
        .normalize();
    }
    const cruise = this.guidance === 'cruise';
    this.speedLimit = flightSpeedLimit(
      near,
      h,
      cruise ? FLIGHT.cruise : input.boost ? FLIGHT.boost : FLIGHT.normal,
    );
    if (cruise) {
      const nav = this.navigation;
      let wanted = Math.min(
        this.speedLimit,
        Math.sqrt(
          2 *
            FLIGHT.deceleration *
            Math.max(0, nav.gap - 45 - Math.max(0, nav.closingSpeed) * 0.75),
        ),
      );
      if (nav.headingError > 15) wanted = Math.min(wanted, nav.headingError > 40 ? 0 : 80);
      this.navigationStatus =
        wanted < this.speed - 2 ? 'braking' : nav.headingError > 2 ? 'aligning' : 'cruising';
      this.speed = approach(
        this.speed,
        wanted,
        (wanted < this.speed ? FLIGHT.deceleration : FLIGHT.boostAcceleration) * dt,
      );
      if (nav.gap < 55 && this.velocity.length() < 3) {
        this.cancelGuidance('arrived');
        this.speed = 0;
        this.onEvent(`已抵达 ${this.selected.name} 近空 · F 扫描，L 着陆`);
      }
    } else {
      const accelerate = input.boost ? FLIGHT.boostAcceleration : FLIGHT.acceleration;
      if (input.brake || this.navigationStatus === 'blocked')
        this.speed = approach(this.speed, 0, FLIGHT.deceleration * dt);
      else if (this.speed > this.speedLimit)
        this.speed = approach(this.speed, this.speedLimit, FLIGHT.deceleration * dt);
      else
        this.speed = MathUtils.clamp(
          this.speed +
            input.throttle * (input.throttle < 0 ? FLIGHT.deceleration : accelerate) * dt,
          -35,
          this.speedLimit,
        );
    }
    const forward = this.forward,
      right = new Vector3(1, 0, 0).applyQuaternion(this.rotation),
      localUp = UP.clone().applyQuaternion(this.rotation);
    const braking = input.brake || this.navigationStatus === 'blocked';
    const desired = forward
      .multiplyScalar(this.speed)
      .addScaledVector(right, braking ? 0 : input.strafe * (h < 100 ? 6 : 55))
      .addScaledVector(localUp, braking ? 0 : input.lift * (h < 100 ? 10 : 55));
    this.velocity.lerp(desired, 1 - Math.exp(-dt * (braking ? 6 : 3)));
    if (this.speed === 0 && this.velocity.length() < 0.03) this.velocity.set(0, 0, 0);
    this.position.addScaledVector(this.velocity, dt);
    for (const p of this.system.planets) {
      const d = this.position.clone().sub(p.position),
        floor = surfaceRadius(p, d.clone().normalize()) + SHIP_LAYOUT.flightClearance;
      if (d.length() < floor) {
        const impact = this.velocity.length();
        this.position.copy(p.position).addScaledVector(d.normalize(), floor);
        this.cancelGuidance('blocked');
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
    // Correct only roll near the ground; leveling must never steer the nose away from input.
    if (h < near.radius * 0.15 && input.roll === 0 && this.guidance === 'off') {
      const f = this.forward,
        craftUp = UP.clone().applyQuaternion(this.rotation).projectOnPlane(f).normalize(),
        surfaceUp = up.clone().projectOnPlane(f).normalize();
      if (surfaceUp.lengthSq() > 0.01) {
        const angle = Math.atan2(
          new Vector3().crossVectors(craftUp, surfaceUp).dot(f),
          craftUp.dot(surfaceUp),
        );
        this.rotation.premultiply(
          new Quaternion().setFromAxisAngle(f, angle * (1 - Math.exp(-dt * 0.3))),
        );
      }
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
    const local = this.position
      .clone()
      .sub(this.shipPosition)
      .applyQuaternion(this.shipRotation.clone().invert());
    const guarded = avoidShipHull(local.clone());
    if (guarded.distanceToSquared(local) > 1e-12) {
      const world = guarded.applyQuaternion(this.shipRotation).add(this.shipPosition);
      const normal = world.sub(p.position).normalize();
      this.position.copy(p.position).addScaledVector(normal, surfaceRadius(p, normal) + 0.18);
    }
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
    if (Math.max(Math.abs(this.speed), this.velocity.length()) > 400) {
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
    this.cancelGuidance();
    this.target = this.system.planets.indexOf(p);
    this.begin('landing');
    this.onEvent('着陆引导启动 · 正在下降至安全地表');
    return true;
  }
  private begin(mode: 'landing' | 'takeoff') {
    this.angularVelocity.set(0, 0, 0);
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
        offset = new Vector3(...SHIP_LAYOUT.exit).applyQuaternion(this.shipRotation);
      const dir = this.shipPosition.clone().sub(p.position).add(offset).normalize();
      this.position.copy(p.position).addScaledVector(dir, surfaceRadius(p, dir) + 0.18);
      this.lookAt(
        this.shipPosition
          .clone()
          .add(new Vector3(...SHIP_LAYOUT.lookTarget).applyQuaternion(this.shipRotation)),
        dir,
      );
      this.onEvent('离舱完成 · WASD 步行 · F 采样 · 靠近飞船按 E 登舱');
      return true;
    }
    if (this.mode === 'walking') {
      if (this.position.distanceTo(this.shipPosition) > SHIP_LAYOUT.boardingRadius) {
        this.onEvent('请返回飞船附近（12 m 内）再登舱');
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
    const p = this.mode === 'walking' ? this.landedPlanet! : this.selected;
    const type = this.mode === 'walking' ? 'sample' : 'scan';
    if (this.mode !== 'walking' && altitude(p, this.position) > p.radius * 3) {
      this.onEvent(`目标 ${p.name} 信号太弱 · 靠近所选行星后按 F 扫描`);
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
    this.cancelGuidance();
    this.angularVelocity.set(0, 0, 0);
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
  selectTarget(index: number) {
    if (this.mode !== 'flight' || !Number.isInteger(index) || !this.system.planets[index])
      return false;
    this.cancelGuidance();
    this.target = index;
    this.blockedBy = null;
    return true;
  }
  navigate(index: number) {
    if (!this.selectTarget(index)) return false;
    this.guidance = 'align';
    this.navigationStatus = 'aligning';
    this.onEvent(`航向辅助 · 正在转向 ${this.selected.name} · G 开始远航引导`);
    return true;
  }
  toggleAlignment() {
    if (this.guidance === 'align') {
      this.cancelGuidance();
      return true;
    }
    return this.navigate(this.target);
  }
  toggleCruise() {
    if (this.mode !== 'flight') return false;
    if (this.guidance === 'cruise') {
      this.cancelGuidance('manual');
      this.onEvent('远航引导已关闭 · 当前速度保留，按 X 制动');
      return true;
    }
    const blocked = routeObstacle(this.system, this.position, this.selected);
    if (blocked) {
      this.blockedBy = blocked;
      this.cancelGuidance('blocked');
      this.onEvent(`航路被 ${blocked} 遮挡 · 请先绕行`);
      return false;
    }
    if (this.navigation.distance <= arrivalClearance(this.selected) + 55) {
      this.onEvent('已在目标近空 · F 扫描，L 着陆');
      return false;
    }
    this.blockedBy = null;
    this.guidance = 'cruise';
    this.navigationStatus = 'aligning';
    this.angularVelocity.set(0, 0, 0);
    this.onEvent(`远航引导启动 · ${this.selected.name} · 接近时自动减速，手动操作可接管`);
    return true;
  }
  cancelGuidance(status: NavigationStatus = 'idle') {
    this.guidance = 'off';
    this.navigationStatus = status;
    if (status !== 'blocked') this.blockedBy = null;
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
      target: this.target,
      velocity: this.velocity.toArray(),
      speed: this.speed,
    };
  }
  restore(value: unknown) {
    this.restoreIssues = [];
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const s = { ...value } as SaveData;
      const modes: Mode[] = ['flight', 'landed', 'walking'];
      if (
        s.version !== 1 ||
        !Number.isInteger(s.system) ||
        !UNIVERSE[s.system] ||
        !modes.includes(s.mode)
      )
        return false;
      // Earlier v1 saves predate velocity/target; missing flight ship transforms
      // can also be reconstructed without moving the player.
      for (const key of ['target', 'velocity', 'speed', 'playTime', 'discoveries'] as const)
        if (s[key] === undefined) this.restoreIssues.push(`default:${key}`);
      if (s.mode === 'flight') {
        if (s.shipPosition === undefined) {
          s.shipPosition = s.position;
          this.restoreIssues.push('default:shipPosition');
        }
        if (s.shipRotation === undefined) {
          s.shipRotation = s.rotation;
          this.restoreIssues.push('default:shipRotation');
        }
      }
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
      if (
        new Quaternion().fromArray(s.rotation).lengthSq() < 1e-12 ||
        new Quaternion().fromArray(s.shipRotation).lengthSq() < 1e-12
      )
        return false;
      const position = new Vector3().fromArray(s.position);
      const shipPosition = new Vector3().fromArray(s.shipPosition);
      // The former finite-only check accepted the centre of a planet. A zero
      // surface normal cannot be repaired by the collision integration.
      for (const p of UNIVERSE[s.system].planets) {
        if (position.distanceTo(p.position) < p.radius * 0.5) return false;
      }
      if (planet && s.mode !== 'flight') {
        if (shipPosition.distanceTo(planet.position) < planet.radius * 0.5) return false;
        if (
          Math.abs(altitude(planet, position)) > 2 ||
          Math.abs(altitude(planet, shipPosition) - 0.61) > 2
        )
          return false;
        if (s.mode === 'landed' && position.distanceTo(shipPosition) > 2) return false;
      }
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
      if (JSON.stringify(discoveries) !== JSON.stringify(s.discoveries ?? {}))
        this.restoreIssues.push('sanitize:discoveries');
      if (s.velocity !== undefined && !finite(s.velocity, 3)) return false;
      if (s.velocity && new Vector3().fromArray(s.velocity).length() > FLIGHT.cruise * 2)
        return false;
      if (s.speed !== undefined && (!Number.isFinite(s.speed) || Math.abs(s.speed) > FLIGHT.cruise))
        return false;
      if (
        s.target !== undefined &&
        (!Number.isInteger(s.target) || !UNIVERSE[s.system].planets[s.target])
      )
        return false;
      this.system = UNIVERSE[s.system];
      this.target = s.target ?? 0;
      this.velocity.fromArray(s.velocity ?? [0, 0, 0]);
      this.speed = s.speed ?? 0;
      if (s.mode !== 'flight') {
        if (this.velocity.lengthSq() !== 0 || this.speed !== 0)
          this.restoreIssues.push('clear:surface-motion');
        this.velocity.set(0, 0, 0);
        this.speed = 0;
      }
      this.cancelGuidance();
      this.angularVelocity.set(0, 0, 0);
      this.position.fromArray(s.position);
      this.rotation.fromArray(s.rotation).normalize();
      this.mode = s.mode;
      this.shipPosition.fromArray(s.shipPosition);
      this.shipRotation.fromArray(s.shipRotation).normalize();
      this.landedPlanet = planet;
      this.discoveries = discoveries;
      this.playTime = Number.isFinite(s.playTime) ? Math.max(0, s.playTime) : 0;
      if (this.playTime !== s.playTime) this.restoreIssues.push('default:playTime');
      this.transition = 0;
      this.walkVertical = 0;
      return true;
    } catch {
      return false;
    }
  }
}
