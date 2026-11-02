import { Vector3 } from 'three';
import { Simulation } from './simulation';
import { FLIGHT, arrivalClearance } from './navigation';

export const scenarioNames = [
  'departure',
  'transfer',
  'approach',
  'high-speed',
  'occluded',
  'behind',
] as const;
export type ScenarioName = (typeof scenarioNames)[number];
/** Explicit fixtures, never a claim that the player flew to this location. Dev/test only. */
export function applyScenario(sim: Simulation, name: string) {
  if (!scenarioNames.includes(name as ScenarioName))
    throw new Error(`Unknown flight scenario: ${name}`);
  const fixture = new Simulation();
  if (name === 'transfer' || name === 'high-speed') {
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
