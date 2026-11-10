/**
 * One line for each number of a tool, shown under the drawing while its field or its dimension is pointed at.
 * Short sentences; what the number means on the machine.
 */
export const TOOL_FIELD_MEANING: Readonly<Record<string, string>> = Object.freeze({
  diameter: 'Diameter: the width the tool cuts.',
  shank: 'Shank diameter: the part the collet grips.',
  stickout: 'Stickout: how far the tool sticks out of the collet. Shorter is stiffer.',
  fluteLength: 'Flute length: the cutting part, from the tip up. It is the deepest cut the tool can take.',
  overallLength: 'Overall length: the whole tool, tip to end.',
  flutes: 'Flutes: the cutting edges. Fewer clear chips better; more leave a smoother wall.',
  cornerRadius: 'Corner radius: the rounded corner at the tip.',
  vAngle: 'V angle: the included angle of the point.',
  tipWidth: 'Tip width: the flat at the very end of the point.',
  pointAngle: 'Point angle: the included angle of the drill point.',
});

export const DRAWING_HINT = 'Point at a number to see it on the drawing.';
