import { createActor, type Actor, type SnapshotFrom } from 'xstate';
import animations from '../../data/animations.json';
import layout from '../../data/scene-layout.json';
import {
  LANE_START_DELAY_MS,
  NAP_EXTRA_MS,
  NAP_STAND_FRAME,
  SNIFF_FRONT_BASE_FRAME,
  TURN_AROUND_FIRST_FRAME,
} from './constants';
import { finishQ, ratMachine, type RatContext, type StepEnv } from './rat-machine';
import type { Random } from './random';
import type { Track, TrackPoint } from './track';

export type AnimName = keyof typeof animations.states;

export type RatMode = 'enter' | 'gate' | 'run' | 'corner' | 'turnAround' | 'wrongWay' | 'exit' | 'gone';

export interface RatIdentity {
  name: string;
  fur: number;
  silk: number;
  lane: number;
}

export interface Pose {
  anim: AnimName;
  frame: number;
  flipX: boolean;
  flipY: boolean;
  /** Extra rotation in degrees, anticlockwise on screen (walking round a corner). */
  rotate?: number;
  /** Second piece drawn underneath (the still rump while sniffing). */
  under?: { anim: AnimName; frame: number };
}

const NOSE = layout.rat.noseOffset;
/** Never run more than this many overdue steps in one update (e.g. after a long frame). */
const MAX_CATCH_UP_STEPS = 4;
/** Overdue steps older than this are dropped rather than replayed. */
const MAX_STEP_LAG_MS = 250;

const norm = (deg: number) => ((deg % 360) + 360) % 360;

/** 180-degree rotation, as the original does for the left and down directions (both mirror bits set). */
const rotated = (p: Pose): Pose => ({ ...p, flipX: !p.flipX, flipY: !p.flipY });
const orient = (p: Pose, heading: number): Pose => (norm(heading) >= 180 ? rotated(p) : p);

/** Running sprite: gait 1100/0-5 (right) or 1100/18-23 (up), rotated for left and down. */
export function runPose(heading: number, gait: number): Pose {
  const h = norm(heading);
  const vertical = h === 90 || h === 270;
  return orient({ anim: vertical ? 'run-up' : 'run-right', frame: ((gait % 6) + 6) % 6, flipX: false, flipY: false }, h);
}

/** Corner sprite k (0-11): right->up 1100/6-17, up->left 1101/0-11, the other two rotated. */
export function cornerPose(heading: number, k: number): Pose {
  const h = norm(heading);
  const vertical = h === 90 || h === 270;
  const frame = Math.min(11, Math.max(0, k));
  return orient({ anim: vertical ? 'turn-up-left' : 'turn-right-up', frame, flipX: false, flipY: false }, h);
}

export class Rat {
  readonly name: string;
  readonly fur: number;
  readonly silk: number;
  readonly lane: number;
  readonly actor: Actor<typeof ratMachine>;
  /** Race-clock ms of the next step. */
  nextStep: number;
  /** Seconds after the gates opened when the nose crossed the finish line. */
  finishTime: number | null = null;

  constructor(id: RatIdentity, track: Track, random: Random) {
    this.name = id.name;
    this.fur = id.fur;
    this.silk = id.silk;
    this.lane = id.lane;
    const gateX = track.gateNoseX(id.lane) - NOSE;
    this.actor = createActor(ratMachine, {
      input: { lane: id.lane, gateX, q: track.qAtBottomX(gateX), startGait: random.int(6) },
    });
    this.actor.start();
    this.nextStep = id.lane * LANE_START_DELAY_MS;
  }

  private get snap(): SnapshotFrom<typeof ratMachine> {
    return this.actor.getSnapshot();
  }

  get ctx(): RatContext {
    return this.snap.context;
  }

  get mode(): RatMode {
    const v = this.snap.value;
    return (typeof v === 'string' ? v : Object.keys(v)[0]) as RatMode;
  }

  get sniffing(): boolean {
    return (
      this.snap.matches({ run: 'sniffing' }) ||
      this.snap.matches({ corner: 'sniffing' }) ||
      this.snap.matches({ wrongWay: 'sniffing' }) ||
      this.snap.matches({ gate: 'sniffing' })
    );
  }

  get napping(): boolean {
    return this.snap.matches({ run: 'napping' }) || this.snap.matches({ corner: 'napping' });
  }

  get q(): number {
    return this.ctx.q;
  }

  get counter(): number {
    return this.ctx.counter;
  }

  get interval(): number {
    return this.ctx.interval;
  }

  /** The original never changes lanes. */
  get v(): number {
    return this.lane;
  }

  get chuteX(): number | null {
    return this.ctx.chuteX;
  }

  get finished(): boolean {
    return this.finishTime !== null;
  }

  get visible(): boolean {
    return this.mode !== 'gone';
  }

  get finishLane(): number {
    return this.lane;
  }

  static finishQ(track: Track): number {
    return finishQ(track);
  }

  /** The gates have dropped. A rat in the middle of a sniff finishes it first (RR_D2 0x06E6). */
  release(now: number): void {
    this.actor.send({ type: 'RELEASE' });
    this.nextStep = Math.min(this.nextStep, now);
  }

  finish(seconds: number): void {
    this.finishTime = seconds;
    this.actor.send({ type: 'FINISH' });
  }

  /** Run every step due by `now`. Returns the race-clock ms at which the nose crossed the finish line, if it did. */
  update(now: number, env: StepEnv): number | null {
    let crossed: number | null = null;
    const goal = finishQ(env.track);
    for (let i = 0; i < MAX_CATCH_UP_STEPS && this.mode !== 'gone' && now >= this.nextStep; i++) {
      const at = this.nextStep;
      const before = this.ctx.chuteX === null ? this.ctx.q : -Infinity;
      this.actor.send({ type: 'STEP', env });
      const extra = this.napping ? NAP_EXTRA_MS : 0;
      this.nextStep = Math.max(at, now - MAX_STEP_LAG_MS) + this.ctx.interval + extra;
      const after = this.ctx.chuteX === null ? this.ctx.q : -Infinity;
      const racing = this.mode === 'run' || this.mode === 'exit';
      if (crossed === null && !this.finished && racing && before < goal && after >= goal) crossed = at;
    }
    return crossed;
  }

  position(track: Track): TrackPoint {
    const c = this.ctx;
    if (c.chuteX !== null) return { x: c.chuteX, y: track.bottomLaneY(this.lane), heading: 0 };
    return track.point(c.q, this.lane);
  }

  /** Direction of the straight the rat is on (or of the corner's entry). */
  private heading(): number {
    if (this.ctx.chuteX !== null) return 0;
    const seg = ((Math.floor(this.ctx.q) % 8) + 8) % 8;
    return 90 * Math.floor(seg / 2);
  }

  pose(): Pose {
    const c = this.ctx;
    const h = this.heading();
    const vertical = h === 90 || h === 270;
    const mode = this.mode;
    const facing = mode === 'wrongWay' ? h + 180 : h;
    if (this.sniffing && c.sniff) {
      // 1101/12 (still rump and tail) under a moving front half 1101/13-17; 1101/18 + 19-23 vertically
      return orient(
        {
          anim: vertical ? 'sniff-front-up' : 'sniff-front',
          frame: Math.min(4, Math.max(0, c.sniff.frame - SNIFF_FRONT_BASE_FRAME)),
          flipX: false,
          flipY: false,
          under: { anim: vertical ? 'sniff-rump-up' : 'sniff-rump', frame: 0 },
        },
        facing,
      );
    }
    if (this.napping && c.nap) {
      // 1101/24-32 + 1102/0-3; vertical straights use 1102/4-16 (original frame + 13)
      return orient(
        { anim: vertical ? 'nap-vertical' : 'nap', frame: c.nap.frame - NAP_STAND_FRAME, flipX: false, flipY: false },
        facing,
      );
    }
    switch (mode) {
      case 'corner':
        // the normal walk cycle, turned to follow the curve
        return { ...runPose(h, c.cornerGait + c.counter + 1), rotate: (90 * (c.counter + 1)) / c.cornerSteps };
      case 'turnAround': {
        // 1102/17-22 turns a right-facing rat round, 1102/23-28 an up-facing one
        const from = c.reversed ? h + 180 : h;
        const k = Math.min(5, Math.max(0, c.counter - TURN_AROUND_FIRST_FRAME));
        return orient({ anim: vertical ? 'turn-around-up' : 'turn-around', frame: k, flipX: false, flipY: false }, from);
      }
      case 'wrongWay':
        return runPose(facing, c.counter);
      default:
        return runPose(h, c.counter);
    }
  }
}
