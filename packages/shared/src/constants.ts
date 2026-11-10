// All physics tuning lives here. SI units.
export const BALL_R = 0.028575;
export const BALL_M = 0.17;
export const BALL_I = (2 / 5) * BALL_M * BALL_R * BALL_R;
export const TABLE_L = 2.54;
export const TABLE_W = 1.27;
export const HALF_L = TABLE_L / 2;
export const HALF_W = TABLE_W / 2;
export const G = 9.81;

export const MU_SLIDE = 0.2;
export const MU_ROLL = 0.014;
export const MU_SPIN = 0.044;
export const BALL_E = 0.95;
export const BALL_MU = 0.06;
export const CUSHION_E = 0.85;
export const CUSHION_MU = 0.2;
export const CUSHION_H = (7 / 5) * BALL_R;

export const CUE_M = 0.54;
export const CUE_V_MIN = 0.3;
export const CUE_V_MAX = 7.5;
export const MAX_HIT = 0.5; // miscue limit as a fraction of R

export const CORNER_MOUTH = 0.114;
export const SIDE_MOUTH = 0.127;
export const JAW_R = 0.012; // radius of the rounded jaw nose
export const CORNER_FACING_DEG = 38; // deviation of the facing from the rail line
export const SIDE_FACING_DEG = 77;
export const FACING_LEN = 0.07; // long enough to run past the drop edge
export const CORNER_HOLE_R = 0.058;
export const CORNER_HOLE_OFFSET = 0.02; // hole centre beyond the table corner, along the pocket axis
export const SIDE_HOLE_R = 0.06;
export const SIDE_HOLE_OFFSET = 0.075; // hole centre beyond the rail line

export const DT = 0.001;
export const MAX_SIM_TIME = 60;
export const KEYFRAME_INTERVAL = 1 / 30;

export const RACK_GAP = 1e-4; // hairline between racked balls, so the break doesn't start in contact
