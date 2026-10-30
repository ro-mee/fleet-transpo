import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parse } from 'espree';
import { describe, expect, it, vi } from 'vitest';
const source = readFileSync(new URL('../app/(app)/(tabs)/map.js', import.meta.url), 'utf8');
const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true }, range: true });
const find = predicate => { const found = []; const walk = n => { if (!n || typeof n !== 'object') return; if (predicate(n)) found.push(n); for (const value of Object.values(n)) { if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value); } }; walk(tree); return found; };
describe('Map arrival conflict and motion behavior', () => {
  it('offers a distance override only for the three geofence conflicts', () => {
    const branches = find(n => n.type === 'IfStatement' && source.slice(...n.consequent.range).includes('offerOverride({') && source.slice(...n.test.range).includes('e?.'));
    expect(branches).toHaveLength(3);
    for (const branch of branches) {
      const condition = source.slice(...branch.test.range);
      expect(runInNewContext(condition, { e: { status: 409, code: 'CARGO_FLEET_CLEARANCE_REQUIRED' } })).toBe(false);
      expect(runInNewContext(condition, { e: { status: 409, code: 'GEOFENCE_OUTSIDE' } })).toBe(true);
    }
  });
  it.each(['snapTo', 'snapToMinimized'])('moves %s immediately when reduced motion is enabled', name => {
    const expression = find(n => n.type === 'VariableDeclarator' && n.id?.name === name)[0].init.arguments[0];
    const panY = { setValue: vi.fn(), stopAnimation: vi.fn() }, spring = vi.fn(() => ({ start: vi.fn() }));
    const callback = runInNewContext(`(${source.slice(...expression.range)})`, { reducedMotion: true, panY, expandedY: 50, collapsedY: 300, screenHeight: 900, setIsExpanded: vi.fn(), setIsMinimized: vi.fn(), isExpandedRef: {}, isMinimizedRef: {}, Animated: { spring } });
    callback(true); expect(spring).not.toHaveBeenCalled(); expect(panY.setValue).toHaveBeenCalledWith(name === 'snapTo' ? 50 : 920);
  });
});