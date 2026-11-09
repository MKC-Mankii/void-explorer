import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Simulation, NO_INPUT, FlightInput } from './simulation';
import { AtmospherePass } from './atmosphere';
import { SurfaceDetails } from './surface-details';
import { Terrain } from './terrain';
import { UNIVERSE, surfaceRadius } from './universe';
import { makeSky, makeStar, makeClouds, makeOcean, makeRings, SpaceDust } from './visuals';
import { CelestialLighting, airState, disposeMaterialResources } from './rendering';
import { UI } from './ui';
import { pickPlanetAtScreen, projectContact, raySphereDistance } from './navigation';
import { applyScenario, observeSimulation, scenarioNames } from './diagnostics';
import { AudioEngine } from './audio';
import { Spacecraft } from './spacecraft';
import { SHIP_LAYOUT } from './ship-layout';
import './style.css';
const SAVE_KEY = 'void-explorer-save-v1',
  SETTINGS_KEY = 'void-explorer-settings-v1';
interface Settings {
  quality: 'low' | 'medium' | 'high';
  sensitivity: number;
  audio: boolean;
}
function readStorage(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
class Game {
  readonly sim = new Simulation();
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(58, innerWidth / innerHeight, 0.04, 800000);
  readonly renderer: T.WebGLRenderer;
  readonly ui: UI;
  readonly audio = new AudioEngine();
  readonly ship = new Spacecraft();
  readonly lighting = new CelestialLighting();
  readonly atmosphere = new AtmospherePass();
  readonly sky = makeSky();
  readonly dust = new SpaceDust();
  readonly details = new SurfaceDetails();
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  private systemGroup = new T.Group();
  private terrains: Terrain[] = [];
  private keys = new Set<string>();
  private mouse = new T.Vector2();
  private cockpit = false;
  private cameraRig = new T.Quaternion();
  private diagnosticScenario: string = 'player';
  private captureFrozen = false;
  private diagnosticShipView: string | null = null;
  private performanceSamples: { frameMs: number; updateMs: number; submissionMs: number }[] = [];
  private readonly diagnosticsEnabled =
    import.meta.env.DEV && new URLSearchParams(location.search).has('test');
  private renderedFrames = 0;
  private shipReadyFrame = Infinity;
  private sceneGeneration = 0;
  private renderedScene = -1;
  private renderedSimulationTime = -1;
  private lastFrameMs = 0;
  private walkPitch = 0;
  private lastTime = 0;
  private elapsed = 0;
  private uiTimer = 0;
  private saveTimer = 0;
  private frameCount = 0;
  private frameTime = 0;
  private jumping = false;
  private saveWarning = false;
  private lockSuppressedUntil = 0;
  private lockAttempts = 0;
  private lastLockAttempt: { input: string; target: number | null; pointerLocked: boolean } | null =
    null;
  private settings: Settings = { quality: 'medium', sensitivity: 1, audio: true };
  private disposed = false;
  constructor() {
    const fixture =
      import.meta.env.DEV && new URLSearchParams(location.search).has('test')
        ? new URLSearchParams(location.search).get('scenario')
        : null;
    const hasSave = fixture ? false : this.sim.restore(readStorage(SAVE_KEY));
    if (fixture) this.diagnosticScenario = applyScenario(this.sim, fixture);
    const settings = readStorage(SETTINGS_KEY) as Partial<Settings> | null;
    if (settings && ['low', 'medium', 'high'].includes(settings.quality ?? ''))
      this.settings.quality = settings.quality!;
    if (settings && typeof settings.sensitivity === 'number')
      this.settings.sensitivity = T.MathUtils.clamp(settings.sensitivity, 0.3, 2);
    if (settings?.audio === false) this.settings.audio = false;
    this.renderer = new T.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
    });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.info.autoReset = false;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setClearColor('#050911');
    this.renderer.domElement.id = 'universe';
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute(
      'aria-label',
      '3D 宇宙探索场景，点击捕获鼠标；W/S 推进，方向键转向，H 查看指南',
    );
    document.querySelector('#app')!.append(this.renderer.domElement);
    const target = new T.WebGLRenderTarget(innerWidth, innerHeight, {
      type: T.HalfFloatType,
      depthTexture: new T.DepthTexture(innerWidth, innerHeight, T.UnsignedIntType),
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(this.atmosphere);
    this.bloom = new UnrealBloomPass(new T.Vector2(innerWidth, innerHeight), 0.38, 0.65, 1.1);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.applyQuality();
    this.scene.add(this.sky, this.ship.group, this.dust.mesh, this.details.group);
    this.scene.add(this.lighting.group);
    this.lighting.bindGroup(this.ship.group);
    this.ui = new UI(this.sim, hasSave);
    const startButton = document.querySelector<HTMLButtonElement>('#start-button')!;
    const startLabel = startButton.innerHTML;
    startButton.disabled = true;
    startButton.textContent = '正在装载 AURORA…';
    this.ship.ready.then((loaded) => {
      startButton.disabled = !loaded;
      if (loaded) {
        this.shipReadyFrame = this.renderedFrames + 1;
        startButton.innerHTML = startLabel;
        this.lighting.bindGroup(this.ship.group);
        this.ship.update(0, 0, this.sim.mode, 0);
        this.updateCamera(1, true);
      } else {
        startButton.textContent = 'AURORA 加载失败 · 请刷新重试';
        this.ui.toast('飞船资源未能加载，请检查网络后刷新页面重试');
      }
    });
    this.ui.onAction = (a, v) => this.action(a, v);
    this.sim.onEvent = (message) => {
      this.ui.toast(message);
      if (message.includes('完成') || message.includes('收录')) this.audio.chime();
    };
    this.loadSystem();
    this.updateCamera(1, true);
    this.listen();
    this.audio.enabled = this.settings.audio;
    this.renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.disposed = true;
      this.save();
      this.ui.toast('图形设备连接中断 · 进度已保存，请刷新页面恢复');
      this.ui.show('pause');
    });
    requestAnimationFrame((t) => this.frame(t));
    // Explicit development-only observation hook for deterministic browser verification.
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('test')) {
      // Observations are copies. Test scripts cannot reach the live game or mutate its vectors.
      (window as unknown as { __VOID__: unknown }).__VOID__ = {
        snapshot: () => this.snapshot(),
        scenarios: [...scenarioNames],
        shipView: (view: string | null) => {
          if (view !== null && !['top', 'front', 'port', 'rear', 'quarter'].includes(view))
            throw new Error('Unknown ship inspection view');
          this.diagnosticShipView = view;
          this.cockpit = false;
          this.updateCamera(1, true);
          return this.snapshot();
        },
        probeTerrain: () => {
          const planet = this.sim.nearest,
            up = this.sim.position.clone().sub(planet.position).normalize(),
            origin = this.sim.position.clone().addScaledVector(up, 20);
          const ray = new T.Raycaster(origin, up.clone().negate(), 0, 100);
          const terrain = this.terrains.find((t) => t.data.id === planet.id)!;
          terrain.group.updateMatrixWorld(true);
          const hits = ray.intersectObject(terrain.group, true).filter((h) => h.object.visible);
          return {
            planet: planet.id,
            renderedRadius: hits[0]?.point.distanceTo(planet.position) ?? null,
            collisionRadius: surfaceRadius(planet, up),
            queued: terrain.diagnostics.queued,
          };
        },
        freeze: (frozen: boolean) => {
          this.captureFrozen = frozen;
          this.keys.clear();
          this.mouse.set(0, 0);
          return this.snapshot();
        },
        scenario: (name: string) => {
          this.releaseMouse();
          this.diagnosticScenario = applyScenario(this.sim, name);
          this.walkPitch = 0;
          this.elapsed = 0;
          this.dust.resetAll();
          this.performanceSamples = [];
          this.loadSystem();
          this.updateCamera(1, true);
          this.ui.update();
          return this.snapshot();
        },
        step: (seconds: number) => {
          if (!Number.isFinite(seconds) || seconds < 0 || seconds > 120)
            throw new Error('Step must be 0–120 simulated seconds');
          for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 60)
            this.sim.tick(Math.min(1 / 60, seconds - elapsed), NO_INPUT);
          this.sync(1 / 60);
          this.updateCamera(1, true);
          for (const terrain of this.terrains) terrain.update(this.camera.position, true);
          this.ui.update();
          return this.snapshot();
        },
      };
    }
  }
  private snapshot() {
    const shipProjection = this.ship.group.position.clone().project(this.camera);
    const asset = this.ship.observe();
    return {
      schemaVersion: 2,
      ...observeSimulation(this.sim),
      scenario: this.diagnosticScenario,
      quality: this.settings.quality,
      cockpit: this.cockpit,
      targeting: {
        attempts: this.lockAttempts,
        lastAttempt: this.lastLockAttempt ? { ...this.lastLockAttempt } : null,
        reticleCandidate: pickPlanetAtScreen(this.sim.system, this.camera, new T.Vector2()),
      },
      ship: {
        ...asset,
        rendered: this.renderedFrames >= this.shipReadyFrame,
        inspectionView: this.diagnosticShipView,
        groundClearances: asset.groundContacts.map((coordinates) => {
          const point = new T.Vector3().fromArray(coordinates);
          const radial = point.sub(this.sim.nearest.position);
          return radial.length() - surfaceRadius(this.sim.nearest, radial.clone().normalize());
        }),
      },
      modal: this.ui.modal,
      paused:
        !this.ui.started ||
        !!this.ui.modal ||
        this.jumping ||
        document.hidden ||
        this.captureFrozen,
      input: {
        keys: [...this.keys],
        pointerLocked: document.pointerLockElement === this.renderer.domElement,
      },
      camera: {
        position: this.camera.position.toArray(),
        rotation: this.camera.quaternion.toArray(),
        shipDistance: this.camera.position.distanceTo(this.sim.position),
        shipProjection: {
          x: shipProjection.x,
          y: shipProjection.y,
          z: shipProjection.z,
          onScreen:
            Math.abs(shipProjection.x) < 1 &&
            Math.abs(shipProjection.y) < 1 &&
            shipProjection.z > -1 &&
            shipProjection.z < 1,
        },
      },
      rendering: {
        ready:
          this.renderedFrames > 0 &&
          this.renderedFrames >= this.shipReadyFrame &&
          this.renderedScene === this.sceneGeneration &&
          this.renderedSimulationTime === this.sim.playTime &&
          !this.jumping &&
          !this.disposed &&
          this.ship.state === 'ready',
        renderedScene: this.renderedScene,
        simulationTime: this.renderedSimulationTime,
        frames: this.renderedFrames,
        sceneGeneration: this.sceneGeneration,
        lastFrameMs: this.lastFrameMs,
        environment: {
          ...this.atmosphere.observe(this.sim.system, this.camera.position),
          details: this.details.diagnostics,
        },
        backend: 'WebGL2',
        pixelRatio: this.renderer.getPixelRatio(),
        viewport: [innerWidth, innerHeight],
        fov: this.camera.fov,
        performanceSamples: this.performanceSamples.map((s) => ({ ...s })),
        textures: this.renderer.info.memory.textures,
        geometries: this.renderer.info.memory.geometries,
        terrain: this.terrains.map((t) => t.diagnostics),
        patches: this.terrains.reduce((n, t) => n + t.patchCount, 0),
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
      },
      patches: this.terrains.reduce((n, t) => n + t.patchCount, 0),
    };
  }
  private loadSystem() {
    this.sceneGeneration++;
    for (const terrain of this.terrains) terrain.dispose();
    this.terrains = [];
    this.systemGroup.traverse((obj) => {
      if (obj instanceof T.Mesh || obj instanceof T.Sprite) {
        obj.geometry?.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          disposeMaterialResources(m);
        }
      }
    });
    this.scene.remove(this.systemGroup);
    this.systemGroup = new T.Group();
    this.scene.add(this.systemGroup);
    const system = this.sim.system;
    this.lighting.configure(system);
    this.atmosphere.configure(system);
    this.systemGroup.add(makeStar(system));
    for (const p of system.planets) {
      const terrain = new Terrain(p);
      this.terrains.push(terrain);
      this.systemGroup.add(terrain.group);
      if (p.ocean) this.systemGroup.add(makeOcean(p), makeClouds(p, this.lighting));
      if (p.rings) this.systemGroup.add(makeRings(p, this.lighting));
    }
    this.lighting.bindGroup(this.systemGroup);
    this.details.clear();
    this.applyQuality();
  }
  private listen() {
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
      this.composer.setSize(innerWidth, innerHeight);
    });
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).matches('input,select,textarea')) return;
      const prevent = ['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      if (prevent.includes(e.code) && this.ui.started && !this.ui.modal) e.preventDefault();
      if (e.code === 'Escape') {
        if (document.pointerLockElement) {
          this.openModal('pause');
          return;
        }
        if (this.ui.modal) {
          this.closeModal();
        } else if (this.ui.started) this.openModal('pause');
        return;
      }
      if (e.code === 'KeyM' && !e.repeat) {
        this.action('map');
        return;
      }
      if (e.code === 'KeyH' && !e.repeat) {
        this.action('help');
        return;
      }
      if (this.ui.modal || !this.ui.started || this.jumping) return;
      this.keys.add(e.code);
      if (e.repeat) return;
      switch (e.code) {
        case 'KeyL':
          this.sim.requestLanding();
          break;
        case 'KeyE':
          this.sim.interact();
          this.walkPitch = 0;
          break;
        case 'Space':
          this.sim.takeoff();
          break;
        case 'KeyF':
          if (this.sim.scan()) {
            this.ui.scan();
            this.save();
          }
          break;
        case 'KeyC':
          this.action('view');
          break;
        case 'KeyV':
          this.lockTarget('keyboard');
          break;
        case 'Tab':
          this.action('cycle');
          break;
        case 'KeyT':
          this.sim.toggleAlignment();
          break;
        case 'KeyG':
          this.sim.toggleCruise();
          break;
        case 'KeyP':
          this.action('photo');
          break;
      }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.set(0, 0);
      if (this.ui.started && !this.ui.modal && !this.jumping) this.openModal('pause');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.save();
        if (this.ui.started && !this.ui.modal) this.openModal('pause');
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.mouse.set(0, 0);
      if (
        !document.pointerLockElement &&
        this.ui.started &&
        !this.ui.modal &&
        !this.jumping &&
        performance.now() > this.lockSuppressedUntil
      )
        this.openModal('pause');
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.renderer.domElement && !this.ui.modal) {
        this.mouse.x += e.movementX;
        this.mouse.y += e.movementY;
      }
    });
    const isGameSurface = (e: MouseEvent) =>
      document.pointerLockElement === this.renderer.domElement ||
      e.target === this.renderer.domElement ||
      (e.target instanceof Element && !!e.target.closest('#contact-markers [data-action=lock]'));
    let lastPointerDown = -Infinity,
      lastSecondary = -Infinity,
      secondaryHeld = false;
    const secondaryDown = (e: MouseEvent) => {
      if (!(e.button === 2 || (e.button === 0 && e.ctrlKey)) || !isGameSurface(e)) return;
      e.preventDefault();
      // Pointer and compatibility mouse events represent one physical press.
      if (
        e.type === 'mousedown' &&
        e.timeStamp - lastPointerDown >= 0 &&
        e.timeStamp - lastPointerDown < 100
      )
        return;
      if (e.type === 'pointerdown') lastPointerDown = e.timeStamp;
      lastSecondary = e.timeStamp;
      secondaryHeld = true;
      this.lockTarget('mouse', e);
    };
    document.addEventListener('pointerdown', secondaryDown, true);
    document.addEventListener('mousedown', secondaryDown, true);
    document.addEventListener(
      'mouseup',
      (e) => {
        if (secondaryHeld && (e.button === 2 || (e.button === 0 && e.ctrlKey)) && isGameSurface(e))
          lastSecondary = e.timeStamp;
        secondaryHeld = false;
      },
      true,
    );
    document.addEventListener(
      'contextmenu',
      (e) => {
        if (!isGameSurface(e)) return;
        e.preventDefault();
        // Some trackpad/accessibility paths deliver only contextmenu. Keep the
        // fallback while avoiding a second selection for a native down/up pair.
        if (e.timeStamp - lastSecondary >= 0 && e.timeStamp - lastSecondary < 750) return;
        this.lockTarget('contextmenu', e);
        lastSecondary = e.timeStamp;
      },
      true,
    );
    this.renderer.domElement.addEventListener('click', (e) => {
      if (e.ctrlKey) return;
      if (this.ui.started && !this.ui.modal && !this.jumping) this.lockMouse();
    });
    addEventListener('pagehide', () => this.save());
  }
  private lockTarget(input: string, event?: MouseEvent) {
    if (!this.ui.started || this.ui.modal || this.jumping) return;
    const locked = document.pointerLockElement === this.renderer.domElement;
    if (this.sim.mode !== 'flight') {
      this.lockAttempts++;
      this.lastLockAttempt = { input, target: null, pointerLocked: locked };
      this.ui.toast(
        this.sim.mode === 'walking'
          ? '请先返回飞船并起飞，再锁定航行目标'
          : this.sim.mode === 'landed'
            ? '请先按 Space 起飞，再锁定航行目标'
            : '当前正在着陆或起飞，请等待自由飞行后再锁定目标',
      );
      return;
    }
    const point = new T.Vector2();
    const marker =
      !locked && event?.target instanceof Element
        ? event.target.closest<HTMLElement>('#contact-markers [data-action=lock]')
        : null;
    if (event && !locked) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      point.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2,
      );
    }
    const index = marker
      ? Number(marker.dataset.value)
      : pickPlanetAtScreen(this.sim.system, this.camera, point);
    this.lockAttempts++;
    this.lastLockAttempt = { input, target: index, pointerLocked: locked };
    if (index !== null) {
      const same = index === this.sim.target;
      if (this.sim.selectTarget(index)) {
        this.ui.update();
        this.ui.toast(
          `${same ? '已确认当前目标' : '已锁定'} ${this.sim.selected.name} · T 对准，G 远航`,
        );
      }
    } else
      this.ui.toast(
        `${locked || !event ? '准星' : '鼠标'}下没有可锁定行星 · 也可按 Tab 或打开星图选择`,
      );
  }
  private lockMouse() {
    try {
      const promise = this.renderer.domElement.requestPointerLock();
      if (promise) promise.catch(() => {});
    } catch {
      /* Arrow keys remain fully usable when pointer lock is unavailable. */
    }
  }
  private releaseMouse() {
    this.lockSuppressedUntil = performance.now() + 350;
    if (document.pointerLockElement) document.exitPointerLock();
    this.keys.clear();
    this.mouse.set(0, 0);
  }
  private openModal(name: string) {
    this.ui.show(name);
    this.releaseMouse();
    this.save();
    this.syncSettings();
  }
  private closeModal() {
    this.ui.close();
    this.mouse.set(0, 0);
    this.lastTime = performance.now();
  }
  private action(action: string, value?: string) {
    switch (action) {
      case 'start':
        if (this.ship.state !== 'ready') return;
        this.ui.start();
        this.audio.start();
        this.lastTime = performance.now();
        this.ui.toast('欢迎登舰，指挥官 · 点击画面驾驶 · H 查看飞行指南');
        break;
      case 'resume':
        this.closeModal();
        this.audio.start();
        break;
      case 'home':
        if (this.ui.started) this.openModal('pause');
        break;
      case 'close':
        this.closeModal();
        break;
      case 'map':
      case 'log':
      case 'help':
      case 'settings':
        if (this.ui.modal === action) this.closeModal();
        else this.openModal(action);
        break;
      case 'map-select':
        this.ui.mapSystem = Number(value);
        this.ui.renderModal();
        break;
      case 'navigate':
        if (this.sim.navigate(Number(value))) {
          this.closeModal();
        } else this.ui.toast('请先起飞，再选择航行目标');
        break;
      case 'jump':
        this.jump(Number(value));
        break;
      case 'align':
        this.sim.toggleAlignment();
        break;
      case 'cruise':
        this.sim.toggleCruise();
        break;
      case 'lock':
        if (this.sim.selectTarget(Number(value)))
          this.ui.toast(`已锁定 ${this.sim.selected.name} · T 航向辅助，G 远航引导`);
        break;
      case 'cycle':
        if (this.sim.mode === 'flight') {
          this.sim.selectTarget((this.sim.target + 1) % this.sim.system.planets.length);
          this.ui.toast(`目的地已切换 · ${this.sim.selected.name} · 按 T 对准航向`);
        }
        break;
      case 'view':
        this.cockpit = !this.cockpit;
        this.ui.view(this.cockpit && this.sim.mode !== 'walking');
        break;
      case 'photo':
        if (this.ui.started) this.ui.togglePhoto();
        break;
      case 'quality':
        if (['low', 'medium', 'high'].includes(value ?? '')) {
          this.settings.quality = value as Settings['quality'];
          this.applyQuality();
          this.persistSettings();
        }
        break;
      case 'sensitivity':
        this.settings.sensitivity = T.MathUtils.clamp(Number(value), 0.3, 2);
        this.persistSettings();
        break;
      case 'audio':
        this.settings.audio = !this.settings.audio;
        this.audio.enabled = this.settings.audio;
        this.audio.start();
        this.syncSettings();
        this.persistSettings();
        break;
      case 'reset':
        if (this.ui.resetConfirm()) {
          try {
            localStorage.removeItem(SAVE_KEY);
          } catch {}
          location.reload();
        }
        break;
    }
  }
  private syncSettings() {
    const q = document.querySelector<HTMLSelectElement>('#quality-setting');
    if (q) q.value = this.settings.quality;
    const sensitivity = document.querySelector<HTMLInputElement>('#sensitivity-setting');
    if (sensitivity) sensitivity.value = String(this.settings.sensitivity);
    const audio = document.querySelector('#audio-setting');
    if (audio) audio.textContent = this.settings.audio ? '已开启' : '已关闭';
  }
  private persistSettings() {
    writeStorage(SETTINGS_KEY, this.settings);
  }
  private applyQuality() {
    const ratio =
      this.settings.quality === 'high'
        ? Math.min(devicePixelRatio, 2)
        : this.settings.quality === 'medium'
          ? Math.min(devicePixelRatio, 1.35)
          : 0.75;
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    this.bloom.enabled = this.settings.quality !== 'low';
    this.atmosphere.quality(this.settings.quality);
  }

  private jump(id: number) {
    if (this.jumping || !UNIVERSE[id] || id === this.sim.system.id) return;
    if (this.sim.mode !== 'flight') {
      this.ui.toast('请先登船并起飞');
      return;
    }
    this.closeModal();
    this.releaseMouse();
    this.jumping = true;
    this.ui.jump(true);
    this.audio.chime();
    setTimeout(() => {
      if (this.sim.jump(id)) {
        this.loadSystem();
        this.updateCamera(1, true);
        this.save();
      }
      this.jumping = false;
      this.ui.jump(false);
    }, 1900);
  }
  private save() {
    if (!this.ui?.started || this.diagnosticScenario !== 'player') return;
    if (!writeStorage(SAVE_KEY, this.sim.save()) && !this.saveWarning) {
      this.saveWarning = true;
      this.ui.toast('浏览器存储不可用 · 本次可继续游戏，但无法保存进度');
    }
  }
  private input(dt: number): FlightInput {
    const k = (code: string) => (this.keys.has(code) ? 1 : 0);
    const sensitivity = this.settings.sensitivity * 0.0016;
    const mx = -this.mouse.x * sensitivity,
      my = -this.mouse.y * sensitivity;
    this.mouse.set(0, 0);
    if (this.sim.mode === 'walking')
      this.walkPitch = T.MathUtils.clamp(
        this.walkPitch + my + (k('ArrowUp') - k('ArrowDown')) * dt,
        -1.3,
        1.3,
      );
    return {
      throttle: k('KeyW') - k('KeyS'),
      strafe: k('KeyD') - k('KeyA'),
      lift: k('Space') - k('ControlLeft') - k('ControlRight'),
      pitch:
        this.sim.mode === 'walking'
          ? 0
          : my / Math.max(dt, 0.001) + (k('ArrowUp') - k('ArrowDown')) * 1.1,
      yaw: mx / Math.max(dt, 0.001) + (k('ArrowLeft') - k('ArrowRight')) * 1.1,
      roll: (k('KeyQ') - k('KeyR')) * 1.25,
      boost: !!k('ShiftLeft') || !!k('ShiftRight'),
      brake: !!k('KeyX'),
    };
  }
  private updateCamera(dt: number, snap = false) {
    const s = this.sim;
    const walking = s.mode === 'walking';
    const target = s.position.clone();
    if (snap) this.cameraRig.copy(s.rotation);
    else this.cameraRig.slerp(s.rotation, 1 - Math.exp(-dt * (walking ? 24 : 10)));
    let desired: T.Vector3, rotation: T.Quaternion;
    if (walking) {
      desired = target;
      rotation = this.cameraRig
        .clone()
        .multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), this.walkPitch));
      if (s.speed > 0.1 && !this.ui.modal) {
        const bob = Math.sin(this.elapsed * 8) * 0.007;
        desired.addScaledVector(new T.Vector3(0, 1, 0).applyQuaternion(s.rotation), bob);
      }
    } else if (this.cockpit) {
      desired = target.add(this.ship.cockpitOffset.clone().applyQuaternion(this.cameraRig));
      rotation = this.cameraRig.clone();
    } else {
      desired = target.add(new T.Vector3(...SHIP_LAYOUT.chase).applyQuaternion(this.cameraRig));
      rotation = this.cameraRig
        .clone()
        .multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -0.1));
    }
    if (!walking) {
      const planet = s.nearest;
      const radial = desired.clone().sub(planet.position);
      const floor = surfaceRadius(planet, radial.clone().normalize()) + (this.cockpit ? 0.18 : 0.6);
      if (radial.length() < floor)
        desired.copy(planet.position).addScaledVector(radial.normalize(), floor);
    }
    this.camera.position.copy(desired);
    this.camera.quaternion.copy(rotation);
    const near = walking || this.cockpit ? 0.008 : 0.04;
    if (this.camera.near !== near) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
    this.camera.up.set(0, 1, 0);
    if (this.diagnosticShipView) {
      const offsets: Record<string, number[]> = {
        top: [0, 2.6, 0],
        front: [0, 0.3, -2.8],
        port: [-2.8, 0.3, 0],
        rear: [0, 0.5, 2.8],
        quarter: [-1.35, 1.1, -1.6],
      };
      const center = this.ship.targetOffset
        .clone()
        .applyQuaternion(s.shipRotation)
        .add(s.shipPosition);
      this.camera.position
        .copy(center)
        .add(
          new T.Vector3()
            .fromArray(offsets[this.diagnosticShipView])
            .applyQuaternion(s.shipRotation),
        );
      this.camera.up
        .set(
          0,
          this.diagnosticShipView === 'top' ? 0 : 1,
          this.diagnosticShipView === 'top' ? -1 : 0,
        )
        .applyQuaternion(s.shipRotation);
      this.camera.lookAt(center);
    }
    const fov = this.cockpit ? 68 : 58 + Math.min(Math.abs(s.speed) / 1100, 1) * 14;
    if (snap) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    } else if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = T.MathUtils.damp(this.camera.fov, fov, 3, dt);
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
    this.ship.group.visible = walking || !this.cockpit;
    this.ui?.view(this.cockpit && !walking);
  }
  private sync(dt: number) {
    const s = this.sim;
    this.ship.group.position.copy(s.shipPosition);
    this.ship.group.quaternion.copy(s.shipRotation);
    this.ship.update(
      s.mode === 'landed' || s.mode === 'walking'
        ? 0
        : Math.max(0.12, Math.min(1, Math.abs(s.speed) / 320)),
      this.captureFrozen ? 0 : this.elapsed,
      s.mode,
      this.captureFrozen ? 0 : dt,
    );
    if (s.mode === 'landed' || s.mode === 'walking') {
      this.ship.conformGear((point) => {
        const radial = point.clone().sub(s.nearest.position);
        return radial.length() - surfaceRadius(s.nearest, radial.clone().normalize());
      });
    }
    this.updateCamera(dt);
    this.sky.position.copy(this.camera.position);
    this.dust.update(
      this.camera,
      s.mode === 'flight' ? s.velocity : new T.Vector3(),
      this.captureFrozen ? 0 : dt,
    );
    const nearest = s.nearest,
      h = s.height;
    for (const terrain of this.terrains) terrain.tick(dt, this.camera.position);
    this.details.group.visible = h < 240;
    if (h < 240) this.details.update(nearest, s.position);
    this.lighting.bindGroup(this.details.group);
    this.atmosphere.update(this.camera);
    // Preserve the continuous daylight contrast cue for pin-point stars; no second surface fog.
    const air = airState(nearest, this.camera.position, s.system.star);
    ((this.sky.children[1] as T.Points).material as T.PointsMaterial).opacity =
      0.85 * (1 - air.density * air.daylight * 0.98);
    this.systemGroup.traverse((o) => {
      if (o instanceof T.Mesh && o.material instanceof T.ShaderMaterial && o.material.uniforms.time)
        o.material.uniforms.time.value = this.captureFrozen ? 0 : s.playTime;
    });
    const contacts = s.system.planets.map((planet, index) => {
      const projection = projectContact(this.camera, planet.position, innerWidth, innerHeight);
      const direction = planet.position.clone().sub(this.camera.position).normalize(),
        distance = this.camera.position.distanceTo(planet.position) - planet.radius;
      const starHit = raySphereDistance(this.camera.position, direction, s.system.star, 2300);
      const occluded =
        (starHit !== null && starHit < distance) ||
        s.system.planets.some((other) => {
          if (other.id === planet.id) return false;
          const hit = raySphereDistance(
            this.camera.position,
            direction,
            other.position,
            other.radius,
          );
          return hit !== null && hit < distance;
        });
      return { index, name: planet.name, ...projection, occluded };
    });
    this.ui.contacts(contacts);
    const aim = pickPlanetAtScreen(this.sim.system, this.camera, new T.Vector2());
    this.ui.aimTarget(
      aim === null ? null : this.sim.system.planets[aim].name,
      document.pointerLockElement === this.renderer.domElement,
    );
    const motion =
      this.sim.velocity.length() > 1
        ? projectContact(
            this.camera,
            this.camera.position
              .clone()
              .addScaledVector(this.sim.velocity.clone().normalize(), 100),
            innerWidth,
            innerHeight,
          )
        : null;
    this.ui.motionMarker(motion);
  }
  private frame(time: number) {
    if (this.disposed) return;
    requestAnimationFrame((t) => this.frame(t));
    const raw = this.lastTime ? (time - this.lastTime) / 1000 : 1 / 60,
      dt = Math.min(raw, 0.25);
    this.lastTime = time;
    this.lastFrameMs = raw * 1000;
    if (!this.captureFrozen) this.elapsed += dt;
    const updateStart = performance.now();
    const active =
      this.ui.started && !this.ui.modal && !this.jumping && !document.hidden && !this.captureFrozen;
    if (active) {
      const input = this.input(dt);
      // Integrate slow render frames in stable physics steps instead of slowing game time.
      for (let remaining = dt; remaining > 0; remaining -= 0.05)
        this.sim.tick(Math.min(0.05, remaining), input);
    } else {
      this.mouse.set(0, 0);
    }
    this.sync(dt);
    this.audio.update(this.sim.speed, active, this.sim.mode === 'walking');
    this.uiTimer += raw;
    this.saveTimer += active ? dt : 0;
    if (this.uiTimer > 0.1) {
      this.uiTimer = 0;
      this.ui.update();
    }
    if (this.saveTimer > 5) {
      this.saveTimer = 0;
      this.save();
    }
    this.frameCount++;
    this.frameTime += raw;
    if (this.frameTime >= 2) {
      const fps = document.querySelector('#fps');
      if (fps) fps.textContent = `${Math.round(this.frameCount / this.frameTime)} FPS`;
      this.frameCount = 0;
      this.frameTime = 0;
    }
    const submitStart = performance.now();
    this.renderer.info.reset();
    this.composer.render();
    if (this.diagnosticsEnabled) {
      this.performanceSamples.push({
        frameMs: raw * 1000,
        updateMs: submitStart - updateStart,
        submissionMs: performance.now() - submitStart,
      });
      if (this.performanceSamples.length > 60) this.performanceSamples.shift();
    }
    this.renderedFrames++;
    this.renderedScene = this.sceneGeneration;
    this.renderedSimulationTime = this.sim.playTime;
  }
}
try {
  new Game();
} catch (error) {
  console.error(error);
  document.querySelector('#app')!.innerHTML =
    '<div class="fatal"><span>VOID EXPLORER</span><h1>暂时无法启动图形引擎</h1><p>请使用支持 WebGL 2 的桌面版 Chrome、Edge、Firefox 或 Safari，<br/>并在浏览器设置中开启硬件加速。</p><button onclick="location.reload()">重新尝试</button></div>';
}
