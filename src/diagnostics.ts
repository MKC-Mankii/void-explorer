import { Vector3 } from 'three';
import { Simulation } from './simulation';
import { surfaceRadius, terrainHeight } from './universe';
import { FLIGHT, arrivalClearance } from './navigation';

export const scenarioNames = [
  'departure',
  'transfer',
  'approach',
  'high-speed',
  'occluded',
  'behind',
  'render-orbit',
  'render-terminator',
  'render-night',
  'render-near',
  'render-atmosphere',
  'render-surface',
  'render-cruise',
  'render-desert',
] as const;
export type ScenarioName = (typeof scenarioNames)[number];
/** Explicit fixtures, never a claim that the player flew to this location. Dev/test only. */
export function applyScenario(sim: Simulation, name: string) {
  if (!scenarioNames.includes(name as ScenarioName))
    throw new Error(`Unknown flight scenario: ${name}`);
  const fixture = new Simulation();
  if (name.startsWith('render-')) {
    if (name === 'render-desert') fixture.selectTarget(1);
    const p = fixture.selected,
      sun = fixture.system.star.clone().sub(p.position).normalize();
    let dir = new Vector3(0.1, 0.25, 1).normalize();
    if (name === 'render-terminator')
      dir = sun
        .clone()
        .cross(new Vector3(0, 1, 0))
        .normalize();
    if (name === 'render-night') dir = sun.clone().negate();
    if (name === 'render-desert')
      dir = sun
        .clone()
        .add(new Vector3(0.3, 0.2, 0.3))
        .normalize();
    if (name === 'render-atmosphere' || name === 'render-surface') {
      // A stable dry location shared by both renderer versions and the flight terrain function.
      let best = -Infinity;
      for (let i = 0; i < 80; i++) {
        const d = new Vector3(Math.sin(i * 2.399963) * 0.3, 0.1 + (i % 7) * 0.04, 1).normalize();
        const h = terrainHeight(p, d);
        if (h > best) {
          best = h;
          dir = d;
        }
      }
      fixture.position
        .copy(p.position)
        .addScaledVector(dir, surfaceRadius(p, dir) + (name === 'render-surface' ? 0.61 : 45));
      const tangent = new Vector3(-1, 0.1, 0.2).projectOnPlane(dir).normalize();
      fixture.lookAt(
        fixture.position.clone().addScaledVector(tangent, 100).addScaledVector(dir, -12),
        dir,
      );
      if (name === 'render-surface') {
        fixture.mode = 'landed';
        fixture.landedPlanet = p;
      }
    } else {
      const height = name === 'render-near' ? p.radius * 0.3 : p.radius * 2.5;
      fixture.position.copy(p.position).addScaledVector(dir, surfaceRadius(p, dir) + height);
      fixture.lookAt(p.position);
      if (name === 'render-cruise') {
        fixture.speed = 900;
        fixture.velocity.copy(fixture.forward).multiplyScalar(900);
      }
    }
  } else if (name === 'transfer' || name === 'high-speed') {
    fixture.position.set(0, 18000, 24000);
    fixture.selectTarget(1);
    fixture.lookAt(fixture.selected.position);
    if (name === 'high-speed') {
      fixture.speed = 900;
      fixture.velocity.copy(fixture.forward).multiplyScalar(900);
    }
  } else if (name === 'approach') {
    fixture.selectTarget(1);
    const p = fixture.selected,
      dir = new Vector3(0.2, 0.25, 1).normalize();
    fixture.position.copy(p.position).addScaledVector(dir, p.radius + 1800);
    fixture.lookAt(p.position);
    fixture.speed = 520;
    fixture.velocity.copy(fixture.forward).multiplyScalar(520);
  } else if (name === 'occluded') {
    fixture.selectTarget(1);
    const origin = fixture.system.planets[0],
      away = origin.position.clone().sub(fixture.selected.position).normalize();
    fixture.position.copy(origin.position).addScaledVector(away, origin.radius * 3);
    fixture.lookAt(fixture.selected.position);
  } else if (name === 'behind') {
    fixture.lookAt(
      fixture.position.clone().add(fixture.position.clone().sub(fixture.selected.position)),
    );
  }
  fixture.shipPosition.copy(fixture.position);
  fixture.shipRotation.copy(fixture.rotation);
  if (!sim.restore(fixture.save())) throw new Error('Scenario failed save validation');
  return name as ScenarioName;
}
export function observeSimulation(sim: Simulation) {
  const nav = sim.navigation;
  return {
    mode: sim.mode,
    system: sim.system.id,
    score: sim.score,
    altitude: sim.height,
    playTime: sim.playTime,
    position: sim.position.toArray(),
    rotation: sim.rotation.toArray(),
    forward: sim.forward.toArray(),
    angularVelocity: sim.angularVelocity.toArray(),
    speed: sim.speed,
    velocity: sim.velocity.toArray(),
    actualSpeed: sim.velocity.length(),
    speedLimit: sim.speedLimit,
    target: sim.target,
    discoveries: structuredClone(sim.discoveries),
    nearest: { id: sim.nearest.id, name: sim.nearest.name },
    navigation: {
      targetId: sim.selected.id,
      targetName: sim.selected.name,
      targetPosition: sim.selected.position.toArray(),
      distance: nav.distance,
      arrivalClearance: arrivalClearance(sim.selected),
      centerDistance: nav.centerDistance,
      arrivalGap: nav.gap,
      headingError: nav.headingError,
      closingSpeed: nav.closingSpeed,
      eta: nav.eta,
      stoppingDistance: nav.stoppingDistance,
      guidance: sim.guidance,
      status: sim.navigationStatus,
      blockedBy: sim.blockedBy,
    },
    limits: {
      normal: FLIGHT.normal,
      boost: FLIGHT.boost,
      cruise: FLIGHT.cruise,
      deceleration: FLIGHT.deceleration,
    },
  };
}
