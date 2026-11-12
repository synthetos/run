/** Display labels only: library records keep their schema values. */
const MATERIALS: Readonly<Record<string, string>> = { carbide: 'Carbide', hss: 'HSS', cobalt: 'Cobalt' };
export const toolMaterialLabel = (value: string): string => MATERIALS[value] ?? value;
export const toolCoatingLabel = (value: string): string => value === 'uncoated' ? 'Uncoated' : value;
