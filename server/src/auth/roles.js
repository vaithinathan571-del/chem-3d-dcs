/**
 * Roles, permissions and demo accounts. Platform independent (no Node APIs)
 * so the runtime can also run inside a browser for the standalone demo.
 */
export const ROLES = ['viewer', 'operator', 'engineer', 'instructor'];

const OPERATOR = ['operate', 'ack', 'shelve', 'ilReset', 'esd', 'train'];
const ENGINEER = [...OPERATOR, 'tune', 'alarmConfig', 'ilBypass'];

export const ROLE_PERMISSIONS = {
  viewer: [],
  operator: OPERATOR,
  engineer: ENGINEER,
  instructor: [...ENGINEER, 'sim', 'malfunction', 'snapshot'],
};

export const DEFAULT_USERS = [
  { username: 'operator', password: 'operator', role: 'operator', displayName: 'Panel Operator' },
  { username: 'engineer', password: 'engineer', role: 'engineer', displayName: 'Control Engineer' },
  { username: 'instructor', password: 'instructor', role: 'instructor', displayName: 'Training Instructor' },
  { username: 'viewer', password: 'viewer', role: 'viewer', displayName: 'Read-only Viewer' },
];

export function can(user, permission) {
  return !!user && !!ROLE_PERMISSIONS[user.role]?.includes(permission);
}

export function publicUser(u) {
  return { username: u.username, role: u.role, displayName: u.displayName ?? u.username, permissions: ROLE_PERMISSIONS[u.role] };
}
