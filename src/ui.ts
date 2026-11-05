import { Simulation } from './simulation';
import { SHIP_LAYOUT } from './ship-layout';
import { UNIVERSE, distanceLabel, altitude } from './universe';
import { ContactProjection, arrivalClearance } from './navigation';
function etaLabel(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  return seconds < 60
    ? `${Math.ceil(seconds)} s`
    : `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`;
}
const icons = {
  map: '<circle cx="12" cy="12" r="8"/><path d="m15 9-2 4-4 2 2-4 4-2Z"/>',
  log: '<path d="M5 4h13v16H5zM8 8h7M8 12h7M8 16h4"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3c-1 1-1 1-1 2M12 17h.01"/>',
  sound: '<path d="m4 10 4-1 5-4v14l-5-4-4-1zM17 8q6 4 0 8"/>',
};
function icon(name: keyof typeof icons) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">${icons[name]}</svg>`;
}
const controls = [
  ['W / S', '推进 / 减速'],
  ['鼠标 / 方向键', '改变航向'],
  ['A / D', '侧向移动'],
  ['Space / Ctrl', '上升 / 下降'],
  ['Q / R', '飞船横滚'],
  ['Shift', '高速推进 / 奔跑'],
  ['X', '惯性制动'],
  ['L', '自动着陆'],
  ['E', '离舱 / 返回飞船'],
  ['Space', '着陆后起飞'],
  ['F', '行星扫描 / 地表采样'],
  ['C', '切换驾驶舱视角'],
  ['T / G', '航向辅助 / 远航引导'],
  ['鼠标右键 / Tab', '准星锁定 / 切换目标'],
  ['M', '星图与跃迁'],
  ['P', '摄影模式（隐藏界面）'],
  ['Esc', '释放鼠标 / 暂停'],
];
export class UI {
  root: HTMLElement;
  modal: string | null = null;
  mapSystem = 0;
  started = false;
  photo = false;
  private notification = 0;
  private scanUntil = 0;
  private confirmReset = false;
  onAction: (action: string, value?: string) => void = () => {};
  constructor(
    private sim: Simulation,
    hasSave: boolean,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'interface';
    document.querySelector('#app')!.append(this.root);
    this.root.innerHTML = `
 <header class="topbar"><a class="wordmark" href="#" data-action="home" aria-label="Void Explorer"><span class="brand-icon">V<span>／</span></span><span>VOID<span class="brand-sub">EXPLORER</span></span></a><div class="expedition"><span class="status-dot"></span>独航者计划<span class="separator">/</span>2401</div><nav><button data-action="map" title="星图 M">${icon('map')}<span>星图</span><kbd>M</kbd></button><button data-action="log" title="探索日志">${icon('log')}<span>日志</span></button><button data-action="help" title="飞行指南 H">${icon('help')}</button><button data-action="settings" title="设置">${icon('settings')}</button></nav></header>
 <div class="frame-corner tl"></div><div class="frame-corner tr"></div><div class="frame-corner bl"></div><div class="frame-corner br"></div>
 <div class="location"><span class="eyebrow" id="sector-label">EX-2401 / 未知边界</span><h2 id="system-label">欧若拉星系</h2><div class="coordinates" id="coordinate-label">SECTOR 07 · ORION ARM</div></div>
 <div class="flight-status"><span class="status-dot"></span><span id="flight-status">飞行系统待命</span><span class="tiny" id="fps"></span></div>
 <div id="target-marker" class="target-marker"><i></i><span id="marker-name">VESPER</span><small id="marker-distance"></small></div>
 <div id="contact-markers" class="game-only"></div><div id="velocity-marker" hidden><i>⊕</i><small>运动方向</small></div>
 <div class="reticle" id="reticle"><i></i><b></b><span></span></div><div id="offscreen" class="offscreen" hidden>◇ 目标在后方 · 按 T 对准</div>
 <section class="target-panel game-only"><div class="panel-heading"><span class="eyebrow">NAVIGATION / 目的地</span><span class="pill" id="target-index">01</span></div><div class="planet-name" id="target-name">VESPER</div><div class="planet-sub" id="target-sub">暮光之境</div><div class="target-range" id="target-range">37.5 km</div><dl class="navigation-data"><div><dt>航向偏差</dt><dd id="target-bearing">—</dd></div><div><dt>接近速度</dt><dd id="target-closure">—</dd></div><div><dt>近空 ETA</dt><dd id="target-eta">—</dd></div><div><dt>探索记录</dt><dd id="target-survey">等待扫描</dd></div></dl><div class="navigation-actions"><button data-action="align" id="align-button">航向辅助 <kbd>T</kbd></button><button data-action="cruise" id="cruise-button">远航引导 <kbd>G</kbd></button></div><button class="text-button" data-action="cycle">切换目的地 <span>Tab ↗</span></button></section>
 <section class="welcome" id="welcome"><div class="eyebrow"><span class="short-line"></span>一场没有边界的独自远行</div><h1>宇宙，<br/>等你抵达<span>。</span></h1><p>驶向遥远的世界，穿过暮色与云层。<br/>在一颗无人知晓的行星上，留下你的足迹。</p><div class="welcome-actions"><button class="primary" data-action="start" id="start-button">${hasSave ? '继续旅程' : '开始航行'}<span>↗</span></button><button class="subtle" data-action="help">飞行指南 ${icon('help')}</button></div><div class="welcome-caption"><span class="status-dot"></span>程序化宇宙 · 5 个星系 · 15 颗可探索行星</div></section>
 <section class="mission game-only"><div class="mission-index" id="mission-index">01</div><div><div class="eyebrow" id="mission-title">首次接触</div><p id="mission-text">按 F 扫描 VESPER，开始你的探索记录</p></div><span class="mission-check" id="mission-check">◇</span></section>
 <div class="context-hint game-only" id="context-hint"><kbd>L</kbd><span>启动自动着陆</span></div>
 <div class="cockpit" id="cockpit" hidden><div class="cockpit-beam left"></div><div class="cockpit-beam right"></div><div class="cockpit-console"><span>AURORA / EXPLORER</span><span>FLIGHT ASSIST ONLINE</span></div></div>
 <footer class="telemetry game-only"><div class="radar"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44"/><circle cx="50" cy="50" r="29"/><circle cx="50" cy="50" r="12"/><path d="M50 2v96M2 50h96"/><path class="radar-craft" d="m50 41-5 14 5-3 5 3Z"/><circle class="radar-target" id="radar-target" cx="50" cy="50" r="2"/></svg><span>SYS · ONLINE</span></div><div class="speed-block"><span class="eyebrow" id="speed-caption">相对速度</span><div><strong id="speed">0000</strong><span class="unit">m/s</span></div><div class="thrust-bar"><i id="thrust-fill"></i></div></div><div class="telemetry-item"><span class="eyebrow">距地表</span><strong id="altitude">29.0 <small>km</small></strong><span class="meta" id="altitude-label">轨道空间</span></div><div class="telemetry-item"><span class="eyebrow">航行状态</span><strong id="drive-state">巡航待命</strong><span class="meta" id="drive-meta">惯性辅助 · 已启用</span></div><div class="telemetry-item score-block"><span class="eyebrow">探索点数</span><strong id="score">0000</strong><span class="meta" id="discovery-count">0 / 15 个世界</span></div><button class="view-button" data-action="view"><span class="view-icon">⌖</span><span id="view-label">追踪视角</span><kbd>C</kbd></button></footer>
 <div class="bottom-controls game-only"><span><kbd>W</kbd><kbd>S</kbd>推进</span><span><kbd>Shift</kbd>加速</span><span><kbd>X</kbd>制动</span><span><kbd>F</kbd>扫描</span><span><kbd>L</kbd>着陆</span><span class="mouse-hint">右键锁定 · T 对准 · G 远航 · Esc 暂停</span></div>
 <div class="idle-footer"><span>AURORA<span class="separator">/</span>深空勘探飞船</span><span>向未知，前进 <span class="arrow">↗</span></span></div>
 <div id="notification" role="status" aria-live="polite"></div><div class="scan-overlay" id="scan-overlay"></div><div class="jump-overlay" id="jump-overlay"><div>SPACETIME TRANSIT</div><strong>正在折叠星空</strong><span>目标坐标已锁定</span></div><div id="modal-root"></div><button id="photo-exit" data-action="photo" hidden>退出摄影模式 P</button>`;
    this.root.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (button) {
        e.preventDefault();
        this.onAction(button.dataset.action!, button.dataset.value);
      }
    });
    this.root.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      if (el.dataset.setting) this.onAction(el.dataset.setting, el.value);
    });
  }
  private el(id: string) {
    return this.root.querySelector<HTMLElement>('#' + id)!;
  }
  private text(id: string, value: string) {
    const el = this.el(id);
    if (el.textContent !== value) el.textContent = value;
  }
  start() {
    this.started = true;
    this.root.classList.add('playing');
    this.el('welcome').hidden = true;
    this.close();
  }
  toast(message: string) {
    this.text('notification', message);
    this.el('notification').classList.add('visible');
    this.notification = performance.now() + 5200;
  }
  scan() {
    this.scanUntil = performance.now() + 2200;
    this.el('scan-overlay').classList.add('active');
  }
  update() {
    const s = this.sim,
      p = s.selected,
      near = s.nearest,
      h = s.height;
    const d = Math.max(0, altitude(p, s.position));
    const record = s.discoveries[p.id];
    this.text(
      'sector-label',
      `${s.system.designation} / ${s.mode === 'walking' ? '地表勘探' : '最近 ' + near.name}`,
    );
    this.text('system-label', s.system.name + '星系');
    this.text(
      'coordinate-label',
      `X ${(s.position.x / 100).toFixed(1)} · Y ${(s.position.y / 100).toFixed(1)} · Z ${(s.position.z / 100).toFixed(1)} km`,
    );
    this.text('target-name', p.name);
    this.text('target-sub', p.epithet);
    this.text('target-range', distanceLabel(d));
    const nav = s.navigation;
    this.text('target-index', String(s.target + 1).padStart(2, '0'));
    this.text(
      'target-bearing',
      `${nav.headingError.toFixed(1)}°${nav.headingError > 90 ? ' · 后半球' : ''}`,
    );
    this.text(
      'target-closure',
      `${nav.closingSpeed < -0.1 ? '远离 ' : ''}${Math.round(Math.abs(nav.closingSpeed) * 10)} m/s`,
    );
    this.text('target-eta', nav.gap < 55 ? '已在近空' : etaLabel(nav.eta));
    this.el('target-eta').title = '按当前接近速度估算至近空边界；不含后续转向和减速';
    (this.el('align-button') as HTMLButtonElement).disabled = s.mode !== 'flight';
    (this.el('cruise-button') as HTMLButtonElement).disabled = s.mode !== 'flight';
    this.el('align-button').classList.toggle('engaged', s.guidance === 'align');
    this.el('cruise-button').classList.toggle('engaged', s.guidance === 'cruise');
    this.el('align-button').innerHTML =
      `${s.guidance === 'align' ? '停止对准' : '航向辅助'} <kbd>T</kbd>`;
    this.el('cruise-button').innerHTML =
      `${s.guidance === 'cruise' ? '取消远航' : '远航引导'} <kbd>G</kbd>`;
    const local = p.position.clone().sub(s.position).applyQuaternion(s.rotation.clone().invert()),
      scale = Math.max(1, local.length());
    this.el('radar-target').setAttribute('cx', String(50 + (local.x / scale) * 35));
    this.el('radar-target').setAttribute('cy', String(50 + (local.z / scale) * 35));
    this.text(
      'target-survey',
      record?.sample
        ? '地表样本已收录'
        : record?.land
          ? '已着陆'
          : record?.scan
            ? '轨道扫描已完成'
            : '等待扫描',
    );
    this.text('marker-name', p.name);
    this.text('marker-distance', distanceLabel(d));
    const speed = Math.abs(s.mode === 'walking' ? s.speed : s.velocity.length());
    this.text('speed', String(Math.round(speed * 10)).padStart(4, '0'));
    this.text('speed-caption', s.mode === 'walking' ? '步行速度' : '相对速度');
    this.text('altitude', distanceLabel(Math.max(0, h)));
    this.text(
      'altitude-label',
      s.mode === 'walking'
        ? '地表探索'
        : h < 30
          ? '近地飞行'
          : h < near.radius * 0.15
            ? '大气层内'
            : h < near.radius
              ? '行星近空'
              : '轨道空间',
    );
    const labels = {
      flight:
        s.guidance === 'align'
          ? '航向对准'
          : s.guidance === 'cruise'
            ? s.navigationStatus === 'braking'
              ? '接近减速'
              : s.navigationStatus === 'aligning'
                ? '巡航转向'
                : '远航引导'
            : s.navigationStatus === 'blocked'
              ? '航路受阻'
              : s.navigationStatus === 'arrived'
                ? '已抵达近空'
                : s.speed < -0.1
                  ? '倒车推进'
                  : s.speed > 330
                    ? '高速推进'
                    : Math.abs(s.speed) > 1
                      ? '惯性巡航'
                      : '巡航待命',
      landing: '自动着陆',
      landed: '已着陆',
      walking: '舱外活动',
      takeoff: '起飞爬升',
    };
    this.text('drive-state', labels[s.mode]);
    this.text(
      'flight-status',
      this.started
        ? `${s.mode === 'walking' ? '宇航服' : '飞行系统'} · ${labels[s.mode]}`
        : '飞行系统待命',
    );
    this.text(
      'drive-meta',
      s.mode === 'walking'
        ? `距飞船 ${distanceLabel(s.position.distanceTo(s.shipPosition))}`
        : s.mode === 'landing'
          ? `下降引导 ${Math.round(Math.min(1, s.transition / 13) * 100)}%`
          : `设定 ${Math.round(s.speed * 10)} · 限速 ${Math.round(s.speedLimit * 10)} m/s`,
    );
    this.el('thrust-fill').style.width = `${Math.min(100, (speed / 320) * 100)}%`;
    this.text('score', String(s.score).padStart(4, '0'));
    this.text(
      'discovery-count',
      `${Object.values(s.discoveries).filter((x) => x.scan || x.land || x.sample).length} / 15 个世界`,
    );
    const objective = s.mode === 'flight' ? p : near;
    const completed = s.discoveries[objective.id];
    const stage = completed?.sample ? 4 : completed?.land ? 3 : completed?.scan ? 2 : 1;
    this.text('mission-index', String(stage).padStart(2, '0'));
    this.text('mission-title', ['首次接触', '降落未知', '留下足迹', '下一段旅程'][stage - 1]);
    this.text(
      'mission-text',
      [
        `按 F 扫描 ${objective.name}，建立行星档案`,
        '按 L 引导着陆，亲自抵达这个世界',
        s.mode === 'landed' ? '按 E 离舱，然后按 F 采集地表样本' : '按 F 采样，记录你的地表发现',
        '返回飞船并起飞，按 M 选择新的目的地',
      ][stage - 1],
    );
    this.text('mission-check', stage === 4 ? '✓' : '◇');
    const hints =
      s.mode === 'landed'
        ? ['E', '离舱探索 · Space 起飞']
        : s.mode === 'walking'
          ? [
              s.position.distanceTo(s.shipPosition) < SHIP_LAYOUT.boardingRadius ? 'E' : 'F',
              s.position.distanceTo(s.shipPosition) < SHIP_LAYOUT.boardingRadius
                ? '返回飞船'
                : '采集地表样本',
            ]
          : s.mode === 'landing'
            ? ['↓', '着陆引导中，请稍候']
            : s.mode === 'takeoff'
              ? ['↑', '正在爬升至安全高度']
              : s.guidance === 'cruise'
                ? ['X', `远航 ${p.name} · 接近自动减速 · 手动操作可接管`]
                : nav.distance > arrivalClearance(p) + 55
                  ? ['G', `前往 ${p.name} · T 航向辅助 · G 远航引导`]
                  : [
                      'L',
                      `${near.name} · ${h < near.radius * 2.5 ? '可自动着陆' : '继续接近后可着陆'}`,
                    ];
    this.el('context-hint').innerHTML = `<kbd>${hints[0]}</kbd><span>${hints[1]}</span>`;
    if (performance.now() > this.notification) this.el('notification').classList.remove('visible');
    if (performance.now() > this.scanUntil) this.el('scan-overlay').classList.remove('active');
  }
  contacts(contacts: (ContactProjection & { index: number; name: string; occluded: boolean })[]) {
    const selected = contacts[this.sim.target],
      marker = this.el('target-marker');
    const show = this.sim.mode === 'flight' && !this.photo;
    marker.hidden = !show;
    marker.style.left = `${selected.x}px`;
    marker.style.top = `${selected.y}px`;
    marker.classList.toggle('edge-target', !selected.onScreen);
    marker.classList.toggle('occluded', selected.occluded);
    marker.querySelector<HTMLElement>('i')!.style.transform = selected.onScreen
      ? 'rotate(45deg)'
      : `rotate(${selected.rotation}deg)`;
    const offscreen = this.el('offscreen');
    offscreen.hidden = !show || selected.onScreen;
    offscreen.textContent = `${selected.occluded ? '目标被天体遮挡' : selected.front ? '目标位于视野边缘' : '目标在后半球'} · T 对准，G 远航`;
    const container = this.el('contact-markers');
    if (!container.children.length)
      container.innerHTML = contacts
        .map(
          (c) =>
            `<button class="contact-marker" data-action="lock" data-value="${c.index}" aria-label="锁定 ${c.name}"><i>◇</i><small>${c.name}</small></button>`,
        )
        .join('');
    for (const c of contacts) {
      const el = container.children[c.index] as HTMLElement;
      el.hidden = !show || c.index === this.sim.target || !c.onScreen || c.occluded;
      el.style.left = `${c.x}px`;
      el.style.top = `${c.y}px`;
    }
  }
  motionMarker(point: ContactProjection | null) {
    const el = this.el('velocity-marker');
    el.hidden =
      !point || !point.onScreen || !this.started || this.photo || this.sim.mode !== 'flight';
    if (point) {
      el.style.left = `${point.x}px`;
      el.style.top = `${point.y}px`;
    }
  }
  view(cockpit: boolean) {
    this.el('cockpit').hidden = !cockpit;
    this.text('view-label', cockpit ? '驾驶舱' : '追踪视角');
  }
  togglePhoto() {
    this.photo = !this.photo;
    this.root.classList.toggle('photo-mode', this.photo);
    this.el('photo-exit').hidden = !this.photo;
  }
  jump(active: boolean) {
    this.el('jump-overlay').classList.toggle('active', active);
  }
  show(name: string) {
    this.modal = name;
    this.confirmReset = false;
    if (name === 'map') this.mapSystem = this.sim.system.id;
    this.renderModal();
  }
  close() {
    this.modal = null;
    this.el('modal-root').innerHTML = '';
  }
  renderModal() {
    if (!this.modal) return;
    const close =
      '<button class="modal-close" data-action="close" aria-label="关闭">× <kbd>Esc</kbd></button>';
    let content = '';
    if (this.modal === 'help')
      content = `<div class="eyebrow">PILOT HANDBOOK / 飞行指南</div><h2>你的星际旅程</h2><p class="modal-description">先扫描，再着陆。在地表采集样本，返回飞船，继续寻找下一个世界。</p><div class="help-grid">${controls.map(([key, label]) => `<div><kbd>${key}</kbd><span>${label}</span></div>`).join('')}</div><div class="tip">松开 W 保持巡航；X 制动，转向后运动方向会逐渐跟随船头。<br/>右键锁定准星内行星；T 渐进对准；G 远航至近空并自动减速，手动驾驶可接管。<br/>L 为最近天体寻找陆地；F 始终扫描所选行星。<br/>航路被天体遮挡时需先手动绕行；ETA 按当前接近速度估算。<br/>地表离舱后为第一人称。点击画面捕获鼠标，Esc 可随时释放。</div>`;
    if (this.modal === 'pause')
      content = `<div class="eyebrow">FLIGHT PAUSED</div><h2>星空会等你。</h2><p class="modal-description">航行已暂停，探索进度保存在此浏览器中。</p><button class="primary" data-action="resume">继续航行 <span>↗</span></button><div class="pause-links"><button data-action="help">飞行指南</button><button data-action="settings">设置</button><button data-action="map">打开星图</button></div>`;
    if (this.modal === 'settings')
      content = `<div class="eyebrow">SHIP CONFIGURATION / 设置</div><h2>调整你的航行</h2><label class="setting-row"><span>画面质量<small>低档关闭泛光，降低像素密度</small></span><select id="quality-setting" data-setting="quality"><option value="low">低 · 流畅优先</option><option value="medium" selected>中 · 平衡</option><option value="high">高 · 视觉优先</option></select></label><label class="setting-row"><span>鼠标灵敏度</span><input data-setting="sensitivity" id="sensitivity-setting" type="range" min="0.3" max="2" step="0.1" value="1"/></label><label class="setting-row"><span>飞船与环境音<small>由程序合成，无外部音频</small></span><button data-action="audio" id="audio-setting">已开启</button></label><div class="save-note">进度自动保存于当前浏览器。无账号、无服务器。<br/>清理浏览器数据会移除存档。</div><button class="danger-subtle" data-action="reset" id="reset-button">重新开始探索…</button>`;
    if (this.modal === 'log') {
      const entries = UNIVERSE.flatMap((sys) =>
        sys.planets.map((p) => ({ p, sys, d: this.sim.discoveries[p.id] })),
      );
      content = `<div class="eyebrow">EXPLORATION ARCHIVE / 探索日志</div><h2>每一次抵达，都有意义。</h2><p class="modal-description">${this.sim.score} 探索点 · ${entries.filter((x) => x.d?.land).length} 次行星着陆 · ${entries.filter((x) => x.d?.sample).length} 份地表样本</p><div class="log-grid">${entries.map(({ p, sys, d }) => `<article class="log-card ${d ? 'discovered' : ''}"><div class="planet-orb" style="--planet:${p.colors[2]};--air:${p.atmosphere}"></div><span class="eyebrow">${sys.name} / ${p.epithet}</span><h3>${p.name}</h3><div class="log-badges"><span class="${d?.scan ? 'done' : ''}">◇ 扫描</span><span class="${d?.land ? 'done' : ''}">⌄ 着陆</span><span class="${d?.sample ? 'done' : ''}">✧ 采样</span></div>${d?.scan ? `<p>${p.temperature}°C · ${p.gravity.toFixed(2)} g · ${p.ocean ? '液态海洋' : '岩石地表'}</p>` : '<p>未知世界 · 等待你的发现</p>'}</article>`).join('')}</div>`;
    }
    if (this.modal === 'map') {
      const sys = UNIVERSE[this.mapSystem];
      content = `<div class="eyebrow">STELLAR CARTOGRAPHY / 星图</div><h2>下一站，未知。</h2><div class="map-layout"><div class="star-chart"><div class="chart-grid"></div><div class="chart-label">ORION ARM<br/><span>已知边界 / 5 个星系</span></div><svg class="chart-lines" viewBox="0 0 600 440"><path d="M120 286 492 88 228 35 510 352 48 405 120 286"/></svg>${UNIVERSE.map((s) => `<button class="star-node ${s.id === this.mapSystem ? 'selected' : ''} ${s.id === this.sim.system.id ? 'current' : ''}" data-action="map-select" data-value="${s.id}" style="left:${50 + s.coord[0] * 85}%;top:${50 + s.coord[1] * 85}%;--star:${s.color}"><i></i><strong>${s.name}</strong><span>${s.designation}${s.id === this.sim.system.id ? ' · 当前位置' : ''}</span></button>`).join('')}<div class="chart-scale">|————|<br/>12.8 LY</div></div><aside class="map-inspector"><span class="eyebrow">${sys.designation}</span><h3>${sys.name}星系</h3><p>3 颗可抵达行星 · 程序化地形</p><div class="map-planets">${sys.planets.map((p, i) => `<button class="${sys.id === this.sim.system.id && i === this.sim.target ? 'active' : ''}" data-action="navigate" data-value="${i}" ${sys.id !== this.sim.system.id ? 'disabled' : ''}><span class="mini-planet" style="background:${p.colors[2]};box-shadow:0 0 14px ${p.atmosphere}33"></span><span><strong>${p.name}</strong><small>${p.epithet}${this.sim.discoveries[p.id]?.land ? ' · 已着陆' : ''}</small></span><span>↗</span></button>`).join('')}</div>${sys.id === this.sim.system.id ? '<div class="map-note"><span class="status-dot"></span>当前星系 · 点击行星选择并渐进对准<br/>关闭星图后按 G 远航，或手动 W / Shift 推进</div>' : `<button class="primary" data-action="jump" data-value="${sys.id}" ${this.sim.mode !== 'flight' ? 'disabled' : ''}>跃迁至此星系 <span>↗</span></button><p class="map-note">${this.sim.mode !== 'flight' ? '需先登船并起飞' : '星际跃迁将抵达首颗行星的近空区域'}</p>`}</aside></div>`;
    }
    this.el('modal-root').innerHTML =
      `<div class="modal-backdrop"><section class="modal ${this.modal === 'map' ? 'map-modal' : this.modal === 'log' ? 'log-modal' : this.modal === 'pause' ? 'pause-modal' : ''}" role="dialog" aria-modal="true" aria-label="${this.modal}">${close}${content}</section></div>`;
  }
  resetConfirm() {
    if (!this.confirmReset) {
      this.confirmReset = true;
      this.text('reset-button', '确认清除全部进度并重新开始');
      return false;
    }
    return true;
  }
}
