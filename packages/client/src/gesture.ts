// Touch aiming and pulling the stick, as pure logic in world coordinates so it can be tested without a DOM.
// Mouse input doesn't come through here; it keeps its point-and-aim behaviour.

export const AIM_SENS = 0.4; // aim turns this fraction of the finger's turn around the cue ball
export const MIN_AIM_RADIUS = 0.06; // metres: closer to the cue ball, the finger's angle around it is too twitchy to use
export const LIFT_IGNORE_MS = 80; // fingers roll as they lift, so the last moves before release are dropped
export const PULL_CANCEL = 0.03; // releasing a pull below this power shoots nothing
export const STICK_REACH = 1.6; // metres behind the ball: the drawn cue (1.45 m) and a little past its butt

export interface Pt { x: number; y: number }
type Sample = { t: number; angle: number; power: number };

export type Release = { angle: number; power: number; shoot: boolean };

/** Is a touch at p on, or just behind, the stick drawn behind the cue ball at this angle? */
export function onStick(p: Pt, cue: Pt, angle: number, halfWidth: number): boolean {
  const bx = -Math.cos(angle);
  const by = -Math.sin(angle);
  const dx = p.x - cue.x;
  const dy = p.y - cue.y;
  const along = dx * bx + dy * by;
  return along > 0 && along < STICK_REACH && Math.abs(dx * by - dy * bx) < halfWidth;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * One finger at a time. An aim drag turns the aim relative to where it began; a pull drags power back
 * along the stick with the aim locked. Release reads the state from LIFT_IGNORE_MS before the lift.
 */
export class TouchGesture {
  kind: 'aim' | 'pull' | null = null;
  angle = 0;
  power = 0;
  private id = -1;
  private last: Pt = { x: 0, y: 0 };
  private along0 = 0;
  private startAngle = 0;
  private history: Sample[] = [];

  get active() {
    return this.id !== -1;
  }

  /** Returns false when another finger already owns the gesture; that touch should be ignored. */
  down(id: number, kind: 'aim' | 'pull', p: Pt, t: number, angle: number, cue: Pt): boolean {
    if (this.active) return false;
    this.id = id;
    this.kind = kind;
    this.angle = angle;
    this.startAngle = angle;
    this.power = 0;
    this.last = { x: p.x - cue.x, y: p.y - cue.y };
    this.along0 = -(this.last.x * Math.cos(angle) + this.last.y * Math.sin(angle));
    this.history = [{ t, angle, power: 0 }];
    return true;
  }

  /** `fullPull` is the drag distance in metres that gives full power. Returns false for a pointer we don't own. */
  move(id: number, p: Pt, t: number, cue: Pt, fullPull: number): boolean {
    if (id !== this.id) return false;
    const rel = { x: p.x - cue.x, y: p.y - cue.y };
    if (this.kind === 'pull') {
      const along = -(rel.x * Math.cos(this.angle) + rel.y * Math.sin(this.angle));
      this.power = Math.max(0, Math.min(1, (along - this.along0) / fullPull));
    } else {
      // Only the change in the finger's direction from the cue ball counts, so a touch never snaps the aim.
      if (Math.hypot(rel.x, rel.y) >= MIN_AIM_RADIUS && Math.hypot(this.last.x, this.last.y) >= MIN_AIM_RADIUS) {
        const turn = wrap(Math.atan2(rel.y, rel.x) - Math.atan2(this.last.y, this.last.x));
        this.angle = wrap(this.angle + turn * AIM_SENS);
      }
      this.last = rel;
    }
    this.history.push({ t, angle: this.angle, power: this.power });
    // Keep only what a release can look back to.
    while (this.history.length > 2 && this.history[1].t < t - 4 * LIFT_IGNORE_MS) this.history.shift();
    return true;
  }

  /** The finger lifted. Returns null for a pointer we don't own. */
  up(id: number, t: number): Release | null {
    if (id !== this.id) return null;
    let settled = this.history[0];
    for (const s of this.history) if (s.t <= t - LIFT_IGNORE_MS) settled = s;
    const pull = this.kind === 'pull';
    this.reset();
    this.angle = settled.angle;
    this.power = pull ? settled.power : 0;
    return { angle: settled.angle, power: this.power, shoot: pull && settled.power >= PULL_CANCEL };
  }

  /** The browser took the pointer (a system gesture, say): nothing shoots and the aim goes back to its start. */
  cancel(id: number): Release | null {
    if (id !== this.id) return null;
    this.reset();
    this.angle = this.startAngle;
    this.power = 0;
    return { angle: this.startAngle, power: 0, shoot: false };
  }

  private reset() {
    this.id = -1;
    this.kind = null;
  }
}
