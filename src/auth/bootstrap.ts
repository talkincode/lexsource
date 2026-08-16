import type { IntelStore } from "../store/db";

export async function ensureBootstrapUsers(
  store: IntelStore,
  env: Record<string, string | undefined> = process.env,
  at = new Date(),
): Promise<{ created: string[] }> {
  const created: string[] = [];
  const adminUser = env.LEXSOURCE_ADMIN_USERNAME?.trim() || "admin";
  const adminPass = env.LEXSOURCE_ADMIN_PASSWORD;
  const lawyerUser = env.LEXSOURCE_LAWYER_USERNAME?.trim() || "lawyer";
  const lawyerPass = env.LEXSOURCE_LAWYER_PASSWORD;

  if (adminPass && !store.getUserByUsername(adminUser)) {
    await store.createUser({ username: adminUser, password: adminPass, role: "admin" }, at);
    created.push(adminUser);
  }
  if (lawyerPass && !store.getUserByUsername(lawyerUser)) {
    await store.createUser({ username: lawyerUser, password: lawyerPass, role: "lawyer" }, at);
    created.push(lawyerUser);
  }
  return { created };
}
