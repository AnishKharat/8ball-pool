import { describe, expect, it } from 'vitest';
import { AIM_SENS, LIFT_IGNORE_MS, onStick, TouchGesture } from './gesture';

const cue = { x: 0, y: 0 };
const FULL = 0.3; // metres of pull for full power
const at = (deg: number, r = 0.5) => ({ x: r * Math.cos((deg * Math.PI) / 180), y: r * Math.sin((deg * Math.PI) / 180) });
const deg = (rad: number) => (rad * 180) / Math.PI;

describe('touch gesture', () => {
  it('turns the aim relative to where the drag began, at reduced sensitivity, and a tap changes nothing', () => {
    const g = new TouchGesture();
    // The finger lands far from the current aim (0 deg): no snap.
    g.down(1, 'aim', at(90), 0, 0, cue);
    expect(g.angle).toBe(0);
    g.move(1, at(100), 50, cue, FULL);
    expect(deg(g.angle)).toBeCloseTo(10 * AIM_SENS, 6);
    g.move(1, at(110), 300, cue, FULL);
    expect(deg(g.up(1, 500)!.angle)).toBeCloseTo(20 * AIM_SENS, 6);

    g.down(2, 'aim', at(-120), 1000, 0.5, cue);
    expect(g.up(2, 1050)).toEqual({ angle: 0.5, power: 0, shoot: false });
  });

  it('drops the movement in the last 80 ms before the finger lifts', () => {
    const g = new TouchGesture();
    g.down(1, 'aim', at(0), 0, 0, cue);
    g.move(1, at(20), 100, cue, FULL);
    g.move(1, at(24), 500 - LIFT_IGNORE_MS / 2, cue, FULL); // the roll of the lifting finger
    expect(deg(g.up(1, 500)!.angle)).toBeCloseTo(20 * AIM_SENS, 6);
  });

  it('ignores a second finger until the first lifts', () => {
    const g = new TouchGesture();
    expect(g.down(1, 'aim', at(0), 0, 0, cue)).toBe(true);
    expect(g.down(2, 'aim', at(90), 10, 0, cue)).toBe(false);
    expect(g.move(2, at(170), 20, cue, FULL)).toBe(false);
    expect(g.up(2, 30)).toBeNull();
    expect(g.angle).toBe(0);
    g.up(1, 200);
    expect(g.down(2, 'aim', at(90), 300, 0, cue)).toBe(true);
  });

  it('holds the aim still near the cue ball, where the finger angle is noise', () => {
    const g = new TouchGesture();
    g.down(1, 'aim', at(0, 0.02), 0, 0, cue);
    g.move(1, at(90, 0.02), 100, cue, FULL);
    expect(g.angle).toBe(0);
  });

  it('pulling the stick sets power from the drag back along it, with the aim locked, and shoots on release', () => {
    const g = new TouchGesture();
    const aim = 0.3;
    const back = (d: number, side = 0) => ({ x: -Math.cos(aim) * d - Math.sin(aim) * side, y: -Math.sin(aim) * d + Math.cos(aim) * side });
    g.down(1, 'pull', back(0.2), 0, aim, cue);
    g.move(1, back(0.35, 0.08), 100, cue, FULL); // sideways wobble doesn't steer
    expect(g.angle).toBe(aim);
    expect(g.power).toBeCloseTo(0.5, 6);
    g.move(1, back(0.8), 200, cue, FULL);
    expect(g.power).toBe(1);
    expect(g.up(1, 400)).toEqual({ angle: aim, power: 1, shoot: true });
  });

  it('sliding the pull back to near zero and releasing cancels', () => {
    const g = new TouchGesture();
    g.down(1, 'pull', at(180, 0.2), 0, 0, cue);
    g.move(1, at(180, 0.4), 100, cue, FULL);
    g.move(1, at(180, 0.203), 300, cue, FULL);
    expect(g.up(1, 500)).toEqual({ angle: 0, power: expect.closeTo(0.01, 2), shoot: false });
  });

  it('a cancelled pointer shoots nothing and restores the aim', () => {
    const g = new TouchGesture();
    g.down(1, 'aim', at(0), 0, 0.2, cue);
    g.move(1, at(40), 100, cue, FULL);
    expect(g.cancel(1)).toEqual({ angle: 0.2, power: 0, shoot: false });
    expect(g.active).toBe(false);
  });

  it('finds the stick behind the ball and nowhere else', () => {
    expect(onStick({ x: -0.5, y: 0.01 }, cue, 0, 0.03)).toBe(true);
    expect(onStick({ x: 0.5, y: 0 }, cue, 0, 0.03)).toBe(false); // in front of the ball
    expect(onStick({ x: -0.5, y: 0.1 }, cue, 0, 0.03)).toBe(false); // beside it
    expect(onStick({ x: 0, y: -0.5 }, cue, Math.PI / 2, 0.03)).toBe(true);
  });
});
