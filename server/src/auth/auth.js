/**
 * Authentication and role-based authorisation.
 *
 * Users are configured through the DCS_USERS environment variable (JSON array
 * of {username, password, role, displayName?}). Passwords are hashed with
 * scrypt at start-up and never stored in clear text. Sessions use
 * HMAC-SHA256 signed bearer tokens.
 */
import crypto from 'node:crypto';

import { ROLES, ROLE_PERMISSIONS, DEFAULT_USERS, can, publicUser } from './roles.js';

export { ROLES, ROLE_PERMISSIONS, DEFAULT_USERS };

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export class AuthService {
  /**
   * @param {{users?: object[], secret?: string, tokenTtlHours?: number}} opts
   */
  constructor({ users = DEFAULT_USERS, secret, tokenTtlHours = 12 } = {}) {
    this.secret = secret || crypto.randomBytes(32).toString('hex');
    this.ttl = tokenTtlHours * 3600_000;
    this.users = new Map();
    for (const u of users) {
      if (!u.username || !u.password || !ROLES.includes(u.role)) throw new Error(`Invalid user definition for "${u.username}"`);
      const salt = crypto.randomBytes(16);
      this.users.set(u.username, {
        username: u.username,
        role: u.role,
        displayName: u.displayName ?? u.username,
        salt,
        hash: crypto.scryptSync(String(u.password), salt, 32),
      });
    }
  }

  /** @returns {{token: string, user: object}|null} */
  login(username, password) {
    const u = this.users.get(String(username ?? ''));
    // Hash even for unknown users to keep timing uniform.
    const salt = u?.salt ?? Buffer.alloc(16);
    const hash = crypto.scryptSync(String(password ?? ''), salt, 32);
    if (!u || !crypto.timingSafeEqual(hash, u.hash)) return null;
    const user = this.publicUser(u);
    return { token: this.sign({ sub: u.username, role: u.role, exp: Date.now() + this.ttl }), user };
  }

  publicUser(u) {
    return publicUser(u);
  }

  sign(payload) {
    const body = b64url(JSON.stringify(payload));
    const mac = crypto.createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${body}.${mac}`;
  }

  /** @returns {object|null} public user for a valid token */
  verify(token) {
    if (typeof token !== 'string' || !token.includes('.')) return null;
    const [body, mac] = token.split('.');
    const expected = crypto.createHmac('sha256', this.secret).update(body).digest('base64url');
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    let payload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (!payload.exp || payload.exp < Date.now()) return null;
    const u = this.users.get(payload.sub);
    if (!u || u.role !== payload.role) return null;
    return this.publicUser(u);
  }

  static can(user, permission) {
    return can(user, permission);
  }
}
