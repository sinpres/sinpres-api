/**
 * Seeds (or resets) an internal admin operator from ADMIN_EMAIL / ADMIN_PASSWORD.
 * There is no self-service signup — this is how an admin account is created.
 *
 *   ADMIN_EMAIL=you@tree.ia.br ADMIN_PASSWORD='...' bun run db:seed:admin
 */
import { eq } from 'drizzle-orm'
import { db } from '../client'
import { adminUsers } from '../schema/public'
import { hashPassword } from '../../shared/password'

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD

  if (!email || !password) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD to seed an admin user.')
    process.exit(1)
  }

  const passwordHash = await hashPassword(password)
  const [existing] = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(eq(adminUsers.email, email))
    .limit(1)

  if (existing) {
    await db
      .update(adminUsers)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(adminUsers.email, email))
    console.log(`Updated password for admin ${email}`)
  } else {
    await db.insert(adminUsers).values({ email, passwordHash })
    console.log(`Created admin ${email}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Admin seed failed:', err)
    process.exit(1)
  })
