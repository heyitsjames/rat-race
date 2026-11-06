import { and, assign, setup } from 'xstate';
import layout from '../../data/scene-layout.json';
import {
  CHECKPOINT_GAIT_FRAME,
  CORNER_FRAMES,
  CORNER_STEP_DIE,
  ENTER_STEP_MS,
  GAIT_FRAMES,
  GATE_STEP_MS,
  NAP_CURL_FIRST,
  NAP_CURL_LAST,
  NAP_LOOPS_MIN,
  NAP_LOOPS_SPREAD,
  NAP_SLEEP_FIRST,
  NAP_SLEEP_LAST,
  NAP_STAND_FRAME,
  NAP_UNCURL_WIGGLES_MIN,
  NAP_UNCURL_WIGGLES_SPREAD,
  NAP_VARIANTS,
  NAP_WIGGLE_HIGH,
  NAP_WIGGLE_LOW,
  NAP_WIGGLES_MIN,
  NAP_WIGGLES_SPREAD,
  SLOWDOWN_ONE_IN,
  SNIFF_FLICK_FRAME,
  SNIFF_VARIANTS,
  SNIFF_WANDER_FIRST,
  SNIFF_WANDER_LAST,
  STEP_MS_BASE,
  STEP_MS_INCREMENT,
  STRAIGHT_STEP_DIE,
  STRIDE_PX,
  TRAINING_ROLL_RANGE,
  TURN_AROUND_FIRST_FRAME,
  TURN_AROUND_LAST_FRAME,
  TURN_AROUND_STEP_MS,
  WRONG_WAY_LIMIT_PX,
  CORNER_SPEED_BLEND,
  FAIR_CORNERS,
  CHECKPOINT_SPACING_PX,
} from './constants';
import type { Random } from './random';
import type { Track } from './track';
import type { TrainingRow } from './training';

/**
 * One rat's behaviour as an XState machine, reconstructed from the original
 * rat state machine (RR_D2 message handler at 0x0420). Original state numbers
 * are noted on each state.
 *
 * Every STEP event is one tick of the rat's own step timer (see Rat.update).
 * Random draws happen only inside STEP actions, using the seeded generator in
 * the event, and their results are stored in context; guards then route on
 * context alone, so a race is fully reproducible from its seed.
 */

/** Everything a step needs from the race. */
export interface StepEnv {
  random: Random;
  track: Track;
  training: TrainingRow;
  /**
   * Distractions allowed (original g03be). On from the gates opening until the
   * winner crosses the line (the owner's recollection of the original; the code
   * reads as "until the winner is inside the pipe"). Once off, every rat drops
   * what it is doing and runs home.
   */
  behavioursOn: boolean;
  /** Original g03c0: a winner has crossed; rats on the home straight now head for the pipe. */
  winnerDecided: boolean;
}

export type Outcome = 'turnAround' | 'nap' | 'sniff' | 'corner' | 'headHome' | null;

export interface Sniff {
  variant: number;
  frame: number;
  fresh: boolean;
}

export interface Nap {
  variant: number;
  frame: number;
  loops: number;
  wiggles: number;
  fresh: boolean;
}

export interface RatContext {
  lane: number;
  /** Anchor x at which the rat stops for its gate. */
  gateX: number;
  /** Loop coordinate (see Track). */
  q: number;
  /** Screen x while in the start chute outside the loop; null on the loop. */
  chuteX: number | null;
  /** Gait frame (0-5) on straights, turn frame in corners, animation frame while turning round. */
  counter: number;
  /** Milliseconds between steps. */
  interval: number;
  /** Straight-line interval to return to after a corner (CORNER_SPEED_BLEND). */
  straightInterval: number;
  /** What the last step decided should happen next. */
  outcome: Outcome;
  /** Set by a step when the current corner, turn-around or distraction has finished. */
  done: boolean;
  /** True once turned round, so the next turn-around brings the rat back. */
  reversed: boolean;
  resumeCounter: number;
  sniff: Sniff | null;
  nap: Nap | null;
  lastSniff: number;
  lastNap: number;
  /** Set when an exiting rat is fully inside the right-hand pipe. */
  inPipe: boolean;
  /** The race has released the rats (original next-state field +0x112 set to 4). */
  released: boolean;
  /**
   * FAIR_CORNERS: px of "virtual straight" this lane has run inside corners (a
   * quarter of its gate stagger per corner). Every checkpoint's worth becomes an
   * extra checkpoint on the next straight, so all lanes get the same number of
   * distraction rolls per race.
   */
  checkpointCredit: number;
  /**
   * Steps in the current corner. The original takes every corner in its 12
   * turn frames; with FAIR_CORNERS the rat takes stride-sized steps instead
   * (the turn frames are spread across them), so slow corners don't jump.
   */
  cornerSteps: number;
  /** Gait frame the rat was on when it entered the corner; the walk cycle carries on from it. */
  cornerGait: number;
}

export interface RatInput {
  lane: number;
  gateX: number;
  q: number;
  /** Random starting gait frame, RandInt(6) (RR_D2 0x0566). */
  startGait: number;
}

export type RatEvent = { type: 'STEP'; env: StepEnv } | { type: 'RELEASE' } | { type: 'FINISH' };

/** Anchor x at which a rat is hidden inside a pipe, beyond the screen edge. */
export const PIPE_HIDE_PX = 110;
const NOSE = layout.rat.noseOffset;

/** Re-rolled step interval: 75 + 17 x RollD(die). */
const rerollInterval = (random: Random, die: number) => STEP_MS_BASE + STEP_MS_INCREMENT * (random.int(die) + 1);
const nextGait = (counter: number) => (counter >= GAIT_FRAMES - 1 ? 0 : counter + 1);

/** Anchor q at which the nose reaches the finish line on the home straight. */
export function finishQ(track: Track): number {
  return 8 + track.qAtBottomX(track.finishX() - NOSE);
}

/** Move `px` along the rat's lane, joining the loop from the chute when it gets there. */
function moveAlong(c: Pick<RatContext, 'q' | 'chuteX' | 'lane'>, px: number, track: Track, canJoin: boolean) {
  let { q, chuteX } = c;
  if (chuteX !== null) {
    chuteX += px;
    const left = track.margin + track.outerRadius;
    if (canJoin && chuteX >= left) {
      const over = chuteX - left;
      chuteX = null;
      q = over / (track.segmentLength(0, c.lane) || 1);
    }
    return { q, chuteX };
  }
  const len = track.segmentLength(Math.floor(q), c.lane) || 1;
  return { q: q + px / len, chuteX };
}

function pickSniff(random: Random, last: number): Sniff {
  let variant = last;
  while (variant === last) variant = random.int(SNIFF_VARIANTS) + 1;
  return { variant, frame: variant === 1 ? SNIFF_FLICK_FRAME : SNIFF_WANDER_FIRST, fresh: true };
}

function pickNap(random: Random, last: number): Nap {
  let variant = last;
  while (variant === last) variant = random.int(NAP_VARIANTS) + 1;
  const deep = variant > NAP_VARIANTS / 2;
  return {
    variant,
    frame: NAP_STAND_FRAME,
    loops: deep ? random.int(NAP_LOOPS_SPREAD) + NAP_LOOPS_MIN : 0,
    wiggles: deep ? 0 : random.int(NAP_WIGGLES_SPREAD) + NAP_WIGGLES_MIN,
    fresh: true,
  };
}

/**
 * Checkpoint, every six steps on a straight (RR_D2 0x0930-0x09C4): one time in
 * three the step interval is re-rolled, then the Training roll walks down the
 * per-thousand odds.
 */
function checkpoint(
  c: RatContext,
  env: StepEnv,
  allowNap: boolean,
): { interval: number; outcome: Outcome; sniff?: Sniff; nap?: Nap } {
  const { random, training } = env;
  const interval = random.int(SLOWDOWN_ONE_IN) === 0 ? rerollInterval(random, STRAIGHT_STEP_DIE) : c.interval;
  let r = random.int(TRAINING_ROLL_RANGE);
  // Running the wrong way, the same roll decides whether to turn back (original:
  // the turn-round odds; Cracked has its own).
  const turnOdds = allowNap ? training.turnAround : (training.turnBack ?? training.turnAround);
  if (r <= turnOdds) return { interval, outcome: 'turnAround' };
  r -= turnOdds;
  if (allowNap) {
    if (r <= training.nap) return { interval, outcome: 'nap', nap: pickNap(random, c.lastNap) };
    r -= training.nap;
  }
  if (r <= training.sniff) return { interval, outcome: 'sniff', sniff: pickSniff(random, c.lastSniff) };
  return { interval, outcome: null };
}

/** f171e: one sniff step. Returns the updated sniff, or null when it ends. */
function sniffStep(s: Sniff, random: Random): Sniff | null {
  const n = { ...s };
  if (n.variant === 1) {
    // head flicks between 1101/13 and 14; may stop each time it is back on 13
    if (n.frame === SNIFF_FLICK_FRAME && !n.fresh && random.int(2) !== 0) return null;
    n.frame = n.frame === SNIFF_FLICK_FRAME ? SNIFF_FLICK_FRAME + 1 : SNIFF_FLICK_FRAME;
  } else {
    // head wanders over 1101/15-17; may stop each time it is back on 15
    if (n.frame === SNIFF_WANDER_FIRST && !n.fresh && random.int(2) !== 0) return null;
    if (n.frame === SNIFF_WANDER_FIRST || n.frame === SNIFF_WANDER_LAST) n.frame = SNIFF_WANDER_FIRST + 1;
    else n.frame += random.int(2) ? 1 : -1;
  }
  n.fresh = false;
  return n;
}

/** f1c1a: one nap step. Returns the updated nap, or null when the rat is back on its feet. */
function napStep(a: Nap, random: Random): Nap | null {
  const n = { ...a };
  const half = NAP_VARIANTS / 2;
  const wiggleLow = (v: number) => (v <= 2 ? NAP_WIGGLE_LOW : NAP_WIGGLE_HIGH);
  if (n.variant > half) {
    const first = n.variant < 7 ? NAP_CURL_FIRST : NAP_SLEEP_FIRST;
    const last = n.variant < 7 ? NAP_CURL_LAST : NAP_SLEEP_LAST;
    if (n.fresh) {
      n.fresh = false;
      n.frame = first;
    } else if (n.frame < last) n.frame++;
    else if (n.loops > 0) {
      n.loops--;
      n.frame = first;
    } else {
      // uncurl with a short wiggle
      n.variant -= half;
      n.wiggles = random.int(NAP_UNCURL_WIGGLES_SPREAD) + NAP_UNCURL_WIGGLES_MIN;
      n.frame = wiggleLow(n.variant);
    }
    return n;
  }
  const lo = wiggleLow(n.variant);
  if (n.fresh) {
    n.fresh = false;
    n.frame = lo;
    return n;
  }
  if (n.frame === NAP_STAND_FRAME) return null;
  if (n.frame === lo) n.frame = lo + 1;
  else if (n.wiggles > 0) {
    n.wiggles--;
    n.frame = lo;
  } else n.frame = NAP_STAND_FRAME;
  return n;
}

export const ratMachine = setup({
  types: {
    context: {} as RatContext,
    events: {} as RatEvent,
    input: {} as RatInput,
  },
  guards: {
    atGate: ({ context }) => context.chuteX === null || context.chuteX >= context.gateX,
    done: ({ context }) => context.done,
    reversed: ({ context }) => context.reversed,
    inPipe: ({ context }) => context.inPipe,
    outcomeTurnAround: ({ context }) => context.outcome === 'turnAround',
    outcomeNap: ({ context }) => context.outcome === 'nap',
    outcomeSniff: ({ context }) => context.outcome === 'sniff',
    outcomeCorner: ({ context }) => context.outcome === 'corner',
    outcomeHeadHome: ({ context }) => context.outcome === 'headHome',
    /** Distractions are over: a napping or sniffing rat gets straight up. */
    distractionsOff: ({ event }) => event.type === 'STEP' && !event.env.behavioursOn,
    released: ({ context }) => context.released,
  },
  actions: {
    resetFlags: assign({ outcome: null, done: false }),

    /** [2] 7 px per step out of the pipe until level with the gate. */
    enterStep: assign(({ context, event }) => {
      if (event.type !== 'STEP') return {};
      const { track } = event.env;
      const x = Math.min(context.gateX, (context.chuteX ?? context.gateX) + STRIDE_PX);
      const onLoop = x >= context.gateX && context.gateX >= track.margin + track.outerRadius;
      return { counter: nextGait(context.counter), chuteX: onLoop ? null : x };
    }),

    /** [3] wait at the gate at 126 ms per step; the race keeps that interval after the gates drop. */
    atGateEntry: assign({ interval: GATE_STEP_MS }),

    markReleased: assign({ released: true }),

    /**
     * [3] RR_D2 0x06E6: at the gate a rat that isn't sniffing starts another sniff
     * (the branch is on g03dc, which is always 0), so rats sniff until released.
     */
    gateSniff: assign(({ context, event }) => {
      if (event.type !== 'STEP') return {};
      const sniff = pickSniff(event.env.random, context.lastSniff);
      return { sniff, lastSniff: sniff.variant, done: false };
    }),

    /** [4]/[8] one running step on a straight. */
    runStep: assign(({ context, event }) => {
      if (event.type !== 'STEP') return {};
      const { env } = event;
      let counter = context.counter;
      const regular = counter === CHECKPOINT_GAIT_FRAME;
      // An extra checkpoint repaying distance this lane covered "for free" in corners.
      const credited = !regular && FAIR_CORNERS && context.checkpointCredit >= CHECKPOINT_SPACING_PX;
      if (credited) context = { ...context, checkpointCredit: context.checkpointCredit - CHECKPOINT_SPACING_PX };
      if (regular && !env.behavioursOn) counter = 0;
      else if ((regular || credited) && !env.behavioursOn) counter++;
      else if (regular || credited) {
        counter = regular ? 0 : counter + 1;
        const c = checkpoint(context, env, true);
        if (c.outcome) {
          return {
            counter,
            interval: c.interval,
            outcome: c.outcome,
            sniff: c.sniff ?? context.sniff,
            nap: c.nap ?? context.nap,
            lastSniff: c.sniff?.variant ?? context.lastSniff,
            lastNap: c.nap?.variant ?? context.lastNap,
            checkpointCredit: context.checkpointCredit,
          };
        }
        context = { ...context, interval: c.interval };
      } else counter++;
      const seg = Math.floor(context.q);
      const moved = moveAlong(context, STRIDE_PX, env.track, true);
      const hitCorner = context.chuteX === null && moved.chuteX === null && Math.floor(moved.q) !== seg && seg % 2 === 0 && seg < 8;
      if (hitCorner) {
        const q = Math.floor(moved.q);
        // Original [4]->[5]: 92 or 109 ms per turn frame. The corner ground speed is
        // blended between the straight-line pace and that original speed (CORNER_SPEED_BLEND).
        const cornerPx = env.track.segmentLength(q, context.lane);
        const turnStepPx = cornerPx / CORNER_FRAMES;
        const steadySpeed = STRIDE_PX / context.interval; // px per ms
        let interval: number;
        let cornerSteps = CORNER_FRAMES;
        if (FAIR_CORNERS) {
          // Inside lane's corner plus a quarter of this lane's gate head start, at the rat's own pace,
          // in stride-sized steps.
          const stagger = env.track.gateNoseX(context.lane) - env.track.gateNoseX(0);
          const fairPx = env.track.segmentLength(q, 0) + stagger / 4;
          cornerSteps = Math.max(CORNER_FRAMES, Math.round(cornerPx / STRIDE_PX));
          interval = fairPx / steadySpeed / cornerSteps;
        } else {
          const originalSpeed = turnStepPx / rerollInterval(env.random, CORNER_STEP_DIE);
          const speed = steadySpeed + (originalSpeed - steadySpeed) * CORNER_SPEED_BLEND;
          interval = Math.round(turnStepPx / speed);
        }
        return { counter, interval, straightInterval: context.interval, q, chuteX: null, outcome: 'corner' as const, checkpointCredit: context.checkpointCredit, cornerSteps, cornerGait: counter };
      }
      // [8] RR_D2 0x1536: once there is a winner, a rat on the home straight heads for the pipe.
      if (env.winnerDecided && moved.chuteX === null && moved.q >= 8) {
        return { counter, interval: context.interval, ...moved, outcome: 'headHome' as const, checkpointCredit: context.checkpointCredit };
      }
      return { counter, interval: context.interval, ...moved, checkpointCredit: context.checkpointCredit };
    }),

    enterCorner: assign({ counter: -1, outcome: null, done: false }),

    /** [5] across the corner: 12 turn frames (original) or stride-sized steps (FAIR_CORNERS). */
    cornerStep: assign(({ context, event }) => {
      const counter = context.counter + 1;
      const start = Math.floor(context.q);
      // The last step lands on the end of the corner and hands straight back to running,
      // with the walk cycle carrying on where it is.
      if (counter >= context.cornerSteps - 1) {
        // back to the rat's straight-line pace (the original keeps the corner's interval)
        const interval = !FAIR_CORNERS && CORNER_SPEED_BLEND >= 1 ? context.interval : context.straightInterval;
        let checkpointCredit = context.checkpointCredit;
        if (FAIR_CORNERS && event.type === 'STEP') {
          const { track } = event.env;
          checkpointCredit += (track.gateNoseX(context.lane) - track.gateNoseX(0)) / 4;
        }
        return { q: start + 1, counter: (context.cornerGait + context.cornerSteps) % 6, done: true, interval, checkpointCredit };
      }
      return { counter, q: start + (counter + 1) / context.cornerSteps - 1e-9 };
    }),

    /** [6] entry: turn-around frames at 126 ms. */
    enterTurnAround: assign(({ context }) => ({
      resumeCounter: context.counter,
      counter: TURN_AROUND_FIRST_FRAME - 1,
      interval: TURN_AROUND_STEP_MS,
      outcome: null,
      done: false,
      sniff: null,
      nap: null,
    })),

    /** [6] one turn-around frame; when finished, a rat going the wrong way starts with a sniff. */
    turnAroundStep: assign(({ context, event }) => {
      if (context.counter < TURN_AROUND_LAST_FRAME) return { counter: context.counter + 1 };
      if (context.reversed || event.type !== 'STEP') return { done: true };
      const sniff = pickSniff(event.env.random, context.lastSniff);
      return { done: true, sniff, lastSniff: sniff.variant };
    }),

    resumeForward: assign(({ context }) => ({ reversed: false, counter: context.resumeCounter })),
    goReversed: assign({ reversed: true, counter: 0 }),

    /** [7] one step running the wrong way: checkpoints can turn it back or make it sniff, never nap. */
    wrongWayStep: assign(({ context, event }) => {
      if (event.type !== 'STEP') return {};
      const { env } = event;
      let counter = context.counter;
      // Distractions over: turn round at once rather than at the next checkpoint.
      if (!env.behavioursOn) return { counter, outcome: 'turnAround' as const };
      if (counter === CHECKPOINT_GAIT_FRAME) {
        counter = 0;
        const c = checkpoint(context, env, false);
        if (c.outcome) {
          return {
            counter,
            interval: c.interval,
            outcome: c.outcome,
            sniff: c.sniff ?? context.sniff,
            lastSniff: c.sniff?.variant ?? context.lastSniff,
          };
        }
        context = { ...context, interval: c.interval };
      } else counter++;
      const seg = Math.floor(context.q);
      const len = env.track.segmentLength(seg, context.lane) || 1;
      const q = context.q - STRIDE_PX / len;
      // back near the start of the straight: turn round (65 px in after a corner)
      const limit = seg + (seg % 8 === 0 && seg < 8 ? 0 : WRONG_WAY_LIMIT_PX / len) + 1e-6;
      if (q < limit) return { counter, interval: context.interval, q: Math.max(context.q, limit), outcome: 'turnAround' as const };
      return { counter, interval: context.interval, q };
    }),

    sniffStep: assign(({ context, event }) => {
      if (event.type !== 'STEP' || !context.sniff) return { done: true };
      const sniff = sniffStep(context.sniff, event.env.random);
      return sniff ? { sniff } : { sniff: null, done: true };
    }),

    napStep: assign(({ context, event }) => {
      if (event.type !== 'STEP' || !context.nap) return { done: true };
      const nap = napStep(context.nap, event.env.random);
      return nap ? { nap } : { nap: null, done: true };
    }),

    /** [9]/[10] after the finish, run on into the right-hand pipe. */
    exitStep: assign(({ context, event }) => {
      if (event.type !== 'STEP') return {};
      const { track } = event.env;
      let { chuteX } = context;
      if (chuteX === null && context.q >= 9) {
        chuteX = track.width - track.margin - track.outerRadius + (context.q - 9) * track.straightH;
      }
      const moved = moveAlong({ ...context, chuteX }, STRIDE_PX, track, false);
      return {
        counter: nextGait(context.counter),
        ...moved,
        inPipe: moved.chuteX !== null && moved.chuteX > track.width + PIPE_HIDE_PX,
      };
    }),

    clearDistraction: assign({ sniff: null, nap: null, outcome: null }),
  },
}).createMachine({
  id: 'rat',
  initial: 'enter',
  context: ({ input }) => ({
    lane: input.lane,
    gateX: input.gateX,
    q: input.q,
    chuteX: -PIPE_HIDE_PX,
    counter: input.startGait,
    interval: ENTER_STEP_MS,
    straightInterval: ENTER_STEP_MS,
    outcome: null,
    done: false,
    reversed: false,
    resumeCounter: 0,
    sniff: null,
    nap: null,
    checkpointCredit: 0,
    cornerSteps: CORNER_FRAMES,
    cornerGait: 0,
    lastSniff: 0,
    lastNap: 0,
    inPipe: false,
    released: false,
  }),
  states: {
    /** [2] out of the left pipe to the gate */
    enter: {
      on: { STEP: { actions: 'enterStep' }, RELEASE: { actions: 'markReleased' } },
      always: { guard: 'atGate', target: 'gate' },
    },
    /** [3] waiting at the gate, sniffing; a released rat finishes its sniff, then runs */
    gate: {
      entry: 'atGateEntry',
      initial: 'idle',
      on: { RELEASE: { actions: 'markReleased' } },
      states: {
        idle: {
          on: {
            STEP: [
              { guard: 'released', target: '#rat.run' },
              { actions: 'gateSniff', target: 'sniffing' },
            ],
          },
        },
        sniffing: {
          on: { STEP: { actions: 'sniffStep' } },
          always: { guard: 'done', target: 'idle' },
        },
      },
    },
    /** [4]/[8] running a straight */
    run: {
      initial: 'moving',
      on: { FINISH: { target: 'exit', actions: 'clearDistraction' } },
      states: {
        moving: {
          entry: 'resetFlags',
          on: { STEP: { actions: 'runStep' } },
          always: [
            { guard: 'outcomeTurnAround', target: '#rat.turnAround' },
            { guard: 'outcomeNap', target: 'napping' },
            { guard: 'outcomeSniff', target: 'sniffing' },
            { guard: 'outcomeCorner', target: '#rat.corner' },
            { guard: 'outcomeHeadHome', target: '#rat.exit', actions: 'clearDistraction' },
          ],
        },
        /** f171e: stop and sniff */
        sniffing: {
          entry: 'resetFlags',
          on: { STEP: [{ guard: 'distractionsOff', target: 'moving', actions: 'clearDistraction' }, { actions: 'sniffStep' }] },
          always: { guard: 'done', target: 'moving' },
        },
        /** f1c1a: curl up / nap */
        napping: {
          entry: 'resetFlags',
          on: { STEP: [{ guard: 'distractionsOff', target: 'moving', actions: 'clearDistraction' }, { actions: 'napStep' }] },
          always: { guard: 'done', target: 'moving' },
        },
      },
    },
    /** [5] turning a corner */
    corner: {
      entry: 'enterCorner',
      on: { STEP: { actions: 'cornerStep' } },
      always: { guard: 'done', target: 'run' },
    },
    /** [6] turning round */
    turnAround: {
      entry: 'enterTurnAround',
      on: { STEP: { actions: 'turnAroundStep' } },
      always: [
        { guard: and(['done', 'reversed']), target: 'run', actions: 'resumeForward' },
        { guard: 'done', target: 'wrongWay', actions: 'goReversed' },
      ],
    },
    /** [7] running the wrong way; it always starts with a sniff */
    wrongWay: {
      initial: 'sniffing',
      states: {
        moving: {
          entry: 'resetFlags',
          on: { STEP: { actions: 'wrongWayStep' } },
          always: [
            { guard: 'outcomeTurnAround', target: '#rat.turnAround' },
            { guard: 'outcomeSniff', target: 'sniffing' },
          ],
        },
        sniffing: {
          entry: 'resetFlags',
          on: { STEP: [{ guard: 'distractionsOff', target: 'moving', actions: 'clearDistraction' }, { actions: 'sniffStep' }] },
          always: { guard: 'done', target: 'moving' },
        },
      },
    },
    /** [9]/[10] finished: on into the right-hand pipe */
    exit: {
      on: { STEP: { actions: 'exitStep' } },
      always: { guard: 'inPipe', target: 'gone' },
    },
    /** [1] gone */
    gone: { type: 'final' },
  },
});
