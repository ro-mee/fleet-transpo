import { describe, it, expect } from 'vitest';
import { can, rolesFor, getRequiredRolesForPath } from '@/lib/auth/permissions';
import { WORKS } from '@/lib/workspaces';

describe('internal Cargo manager authority', () => {
  it('allows managers and administrators but does not grant dispatchers decision authority', () => {
    expect(rolesFor('cargo', 'review_internal')).toEqual(['super_admin', 'admin', 'fleet_manager']);
    for (const role of ['admin', 'fleet_manager', 'super_admin']) expect(can({ roles: { role_name: role } }, 'cargo', 'review_internal')).toBe(true);
    for (const role of ['dispatcher', 'management', 'driver', 'mechanic']) expect(can({ roles: { role_name: role } }, 'cargo', 'review_internal')).toBe(false);
  });
  it('protects the entire review workspace and makes it discoverable for its owners', () => {
    expect(getRequiredRolesForPath('/cargo-review/7')).toEqual(['super_admin', 'admin', 'fleet_manager']);
    const links = groups => groups.flatMap(group => group.items.flatMap(item => [item.href, ...(item.children || []).map(child => child.href)]));
    for (const role of ['admin', 'fleet_manager', 'super_admin']) expect(links(WORKS[role].nav)).toContain('/cargo-review');
    expect(links(WORKS.dispatcher.nav)).not.toContain('/cargo-review');
  });
});
