/**
 * A real CAM header for the tool-mismatch tests (no tests here): solidcraft_docklight_housing_top.gcode (TinyG-work corpus), as written: lines 1 to 8, 30 to 34 (the second T1
 * description) and 1412 to 1418 (T2). Its T1 is a 6 mm end mill, where the owner's tool table has 3.175 mm.
 */
export const DOCKLIGHT: readonly string[] = [
  '(docklight-housing-top)',
  'G17 G21 G90 G91.1 G94 G54 G49 G64',
  '(Boss top: T1 D6 flat end mill)',
  'M5',
  'T1 M6',
  'M0',
  'S12000 M3',
  'G0 Z5',
  'G1 Y53',
  'G0 Z5',
  '(Cavity: T1 D6 flat end mill)',
  'G0 Z5',
  'G0 X16.6 Y-1.6',
  'G1 X43 Y-26.9018',
  'G0 Z5',
  '(O-ring groove: T2 D3 flat end mill)',
  'M5',
  'T2 M6',
  'M0',
  'S16000 M3',
];
