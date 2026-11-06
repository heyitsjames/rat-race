/**
 * Numbers recovered from the original Rat Race 3.0 module code.
 *
 * "RR_D1" is CODE 129 and "RR_D2" is CODE 130 of the module resource fork;
 * addresses are offsets into the disassemblies (see docs/RECONSTRUCTION.md).
 * The original runs on a millisecond clock and moves rats in whole pixels per step.
 */

// ---- Stepping -------------------------------------------------------------

/** Pixels a rat moves per step. RR_D2 0x00D0 (5 while placing), 0x0756, 0x11B4; -7 backwards at 0x11EE. */
export const STRIDE_PX = 7;
/** Step interval coming out of the pipe. RR_D2 0x05E2 (state 2 entry). */
export const ENTER_STEP_MS = 75;
/** Step interval while waiting at the gate, and on leaving it. RR_D2 0x06BC (state 3 entry). */
export const GATE_STEP_MS = 126;
/** Step interval while turning round. RR_D2 0x0F5A (state 6 entry). */
export const TURN_AROUND_STEP_MS = 126;
/** Re-rolled step interval = BASE + INCREMENT x RollD(n). RR_D2 0x0956-0x096E. */
export const STEP_MS_BASE = 75;
export const STEP_MS_INCREMENT = 17;
/** RollD(3) on straights (92, 109 or 126 ms); RollD(2) entering a corner (92 or 109 ms). RR_D2 0x0950, 0x0AD0. */
export const STRAIGHT_STEP_DIE = 3;
export const CORNER_STEP_DIE = 2;
/** A straight re-rolls its interval when RandInt(3) == 0, i.e. one checkpoint in three. RR_D2 0x0944. */
export const SLOWDOWN_ONE_IN = 3;
/** Extra delay on every nap step. RR_D2 0x2082 (addi.l 0x11 to the next-step time). */
export const NAP_EXTRA_MS = 17;
/** Lane n's first step out of the pipe is delayed n x 25 ms. RR_D2 0x05B4 (mulu 0x19). */
export const LANE_START_DELAY_MS = 25;

// ---- Gait and checkpoints ---------------------------------------------------

/** Running gait frames per cycle (1100/0-5 and 1100/18-23); the counter wraps 5 -> 0. RR_D2 0x063E. */
export const GAIT_FRAMES = 6;
/** Gait frame at which a straight runs its checkpoint (counter == EC, EC = 5). RR_D2 0x08E8. */
export const CHECKPOINT_GAIT_FRAME = 5;
/** Distance between checkpoints: one every six strides. */
export const CHECKPOINT_SPACING_PX = (CHECKPOINT_GAIT_FRAME + 1) * STRIDE_PX;
/** Turn frames per corner (counter 0..FA, FA = 11). RR_D2 0x0B88, 0x0BB4. */
export const CORNER_FRAMES = 12;
/** Training roll: RandInt(1000) compared with the per-thousand odds in TRAINING_TABLE. RR_D2 0x0988. */
export const TRAINING_ROLL_RANGE = 1000;

// ---- Distraction animations (original frame numbers) -----------------------
// The rat's animation numbers its frames across 1100 (0-23), 1101 (24-56) and
// 1102 (57-85).

/** Turn-around runs frames 74-79 (1102/17-22) after starting from 73. RR_D2 0x0F52, 0x0F80. */
export const TURN_AROUND_FIRST_FRAME = 74;
export const TURN_AROUND_LAST_FRAME = 79;
/** Sniff variants: RollD(3), never the same twice running. RR_D2 0x175A. */
export const SNIFF_VARIANTS = 3;
/** Variant 1 flicks between 37 and 38 (1101/13-14). RR_D2 0x1830-0x1868. */
export const SNIFF_FLICK_FRAME = 37;
/** Variants 2 and 3 wander over 39-41 (1101/15-17). RR_D2 0x187A-0x192E. */
export const SNIFF_WANDER_FIRST = 39;
export const SNIFF_WANDER_LAST = 41;
/** First sniff front frame (1101/13); fronts run 37-41 and the still rump is 36 (1101/12). */
export const SNIFF_FRONT_BASE_FRAME = 37;
/** Nap variants: RollD(8), never the same twice running. RR_D2 0x1C66. */
export const NAP_VARIANTS = 8;
/** Nap frames: 48 = standing (1101/24), 49-56 curl (1101/25-32), 57-60 asleep (1102/0-3). RR_D2 f1c1a. */
export const NAP_STAND_FRAME = 48;
/** Shallow variants 1-2 wiggle on 49/50, 3-4 on 51/52. RR_D2 0x1D7C-0x1D90. */
export const NAP_WIGGLE_LOW = 49;
export const NAP_WIGGLE_HIGH = 51;
/** Deep variants 5-6 loop the curl 53-56, 7-8 the sleep 57-60. RR_D2 0x1E6A-0x1EC4. */
export const NAP_CURL_FIRST = 53;
export const NAP_CURL_LAST = 56;
export const NAP_SLEEP_FIRST = 57;
export const NAP_SLEEP_LAST = 60;
/** Shallow naps wiggle RandInt(3) + 4 times; deep naps loop RandInt(2) + 2 more times. RR_D2 0x1D00, 0x1D18. */
export const NAP_WIGGLES_MIN = 4;
export const NAP_WIGGLES_SPREAD = 3;
export const NAP_LOOPS_MIN = 2;
export const NAP_LOOPS_SPREAD = 2;
/** After a deep nap the rat uncurls with RandInt(2) + 2 wiggles. RR_D2 0x1F60. */
export const NAP_UNCURL_WIGGLES_MIN = 2;
export const NAP_UNCURL_WIGGLES_SPREAD = 2;

// ---- Race -------------------------------------------------------------------

/** Finish line x = screen right - 184, minus 30 more with three lanes. RR_D1 0x1E32-0x1E46. */
export const FINISH_FROM_RIGHT_PX = 184;
export const FINISH_THREE_LANE_EXTRA_PX = 30;
/** Music control value / 25 gives Never, Once, Twice, Always. RR_D1 0x18AE. */
export const MUSIC_CONTROL_STEP = 25;

// ---- Race controller (RR_D1, stage machine at this+0x54) -------------------

/** Gate timer set at race setup: now + RandInt(4) x 500 ms. RR_D1 0x4ACE-0x4AF0. */
export const GATE_DELAY_DIE = 4;
export const GATE_DELAY_STEP_MS = 500;
/** With music off (or failing to start) the controller waits this long for the "intro". RR_D1 0x5BDA (0x2710). */
export const NO_MUSIC_INTRO_MS = 10_000;
/**
 * With music on it waits for SONG 30 to finish (RR_D1 f5ca4), i.e. until its MIDI
 * end-of-track at 13.421 s (cmid 30), which comes about half a second after the
 * last note. Used so the simulation stays deterministic whether or not the
 * browser has unlocked audio yet; the rendered WAV has the same length.
 */
export const INTRO_SONG_MS = 13_421;
/**
 * Gate doors (RR_D1 f03c2): on the go signal a door shows frame 1 at once and
 * frame 2 one 175 ms tick later, and the rats are released once every door is
 * down (RR_D1 f038c, 0xAF). The dropped doors stay up for the rest of the race.
 */
export const GATE_FRAME_MS = 175;
/** Photo finish: another rat on the leader's straight within 20 px of it when the winner crosses. RR_D1 0x5370-0x53E0. */
export const PHOTO_FINISH_RANGE_PX = 20;
/** The photo-finish board shows for 3 s. RR_D1 0x51A0 (0xBB8). */
export const PHOTO_SHOW_MS = 3_000;
/**
 * A rat running the wrong way turns back 65 px into its straight, measured from
 * where it came out of the previous corner (RR_D2 0x0E6C-0x0ED0, the corner-exit
 * handler sets the limit to its position -/+ 65). On the first straight the
 * limit is screen-left + 130 (RR_D2 0x0268), which this remake approximates as
 * the start of the straight.
 */
export const WRONG_WAY_LIMIT_PX = 65;

// ---- Deliberate deviations from the original ---------------------------------

/**
 * The original turns every corner in 12 steps at a re-rolled
 * 92 or 109 ms, so rats visibly speed up through corners (the outer lane covers
 * ~3x its straight-line distance per step). This blends the corner ground speed
 * between the rat's straight-line pace (0) and the original's corner speed (1).
 * 1 is the original lurch. Ignored while FAIR_CORNERS is on.
 */
export const CORNER_SPEED_BLEND = 1;

/**
 * Not in the original: lane-fair corners (owner's choice, 2026-11-05).
 *
 * The straights are the same length in every lane, and the gates put lane v
 * stagger_v px ahead of the inside lane, so in the original the outer lanes
 * get that head start for free (corners take 12 steps in every lane). With
 * this on, each corner takes a rat the time it needs, at its own straight-line
 * pace, to cover the inside lane's corner plus a quarter of its lane's
 * stagger. Over the four corners that exactly repays the head start, so every
 * lane needs the same time to finish at the same pace. Outer rats still speed
 * up a little through corners, much less than the original.
 *
 * The inside lane would still spend more of that time on straights, where
 * distractions are rolled. Without CORNER_DISTRACTIONS the same corner distance is
 * credited toward checkpoints on the next straight (RatContext.checkpointCredit);
 * with it, corners roll for themselves.
 */
export const FAIR_CORNERS = true;

/**
 * Not in the original: distractions in corners (owner's choice, 2026-11-05;
 * needs FAIR_CORNERS). With FAIR_CORNERS alone, outer lanes spend more of the
 * race in corners, where nothing distracts a rat, and are owed the difference
 * as extra rolls on the next straight. Those rolls land within the first
 * 40-90 px, right by the wrong-way limit, so a turnaround there costs almost
 * nothing, and with 4-8 lanes the outer lanes won up to twice their share at
 * the slower Training levels. With this on, rolls happen every
 * CHECKPOINT_SPACING_PX of "fair" distance all the way round, corners included
 * (a corner counts as the inside lane's corner plus CORNER_REPAY x a quarter
 * of the lane's stagger); a rat can sniff or nap in a corner, and one that
 * turns round there runs back through the corner and on down the straight
 * behind it.
 */
export const CORNER_DISTRACTIONS = true;

/**
 * Share of each lane's gate head start that its four corners repay (FAIR_CORNERS):
 * 1 repays it exactly. Tried at 1.05 and 1.1: the slower Training levels came out
 * flatter but Cracked tipped toward the inside lane, so it stays at 1. Measured with
 * tools/lane-slope.ts over 1,000 races per level and rat count (4-8): the worst cells
 * leave the outer lanes 1-2 points of win share ahead (e.g. 8 rats at Grade School,
 * 14.2% outside vs 11.5% inside, fair 12.5%), down from up to 9 points.
 */
export const CORNER_REPAY = 1;
