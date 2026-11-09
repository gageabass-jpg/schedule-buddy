// Motion timings shared by the to-do list and its pieces.

/** Quick start, soft landing: for fades, strikes and check marks. */
export const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

/** Rows sliding to make room for each other. */
export const SPRING_LAYOUT = { type: "spring", stiffness: 520, damping: 42, mass: 0.9 } as const;

/** Small things swapping places: the header icon, the chevron, the count. */
export const SPRING_SWAP = { type: "spring", stiffness: 420, damping: 32 } as const;
