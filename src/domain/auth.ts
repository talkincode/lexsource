export const RoleSchema = ["admin", "lawyer"] as const;
export type Role = (typeof RoleSchema)[number];

export type User = {
  id: string;
  username: string;
  role: Role;
  createdAt: string;
};

export type SessionRecord = {
  token: string;
  userId: string;
  expiresAt: string;
};

export const SESSION_COOKIE = "lexsource_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function isRole(value: string): value is Role {
  return RoleSchema.includes(value as Role);
}

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id" });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

export function publicUser(user: User): Pick<User, "id" | "username" | "role"> {
  return { id: user.id, username: user.username, role: user.role };
}
