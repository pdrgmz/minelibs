import argon2 from 'argon2';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';

config();
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const username = process.env.ADMIN_USERNAME ?? 'admin';
  const password = process.env.ADMIN_PASSWORD ?? 'cambiar-esta-contrasena';
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`El usuario ${username} ya existe; no se ha modificado.`);
    return;
  }
  await prisma.user.create({
    data: { username, passwordHash: await argon2.hash(password, { type: argon2.argon2id }), role: 'ADMIN' },
  });
  console.log(`Administrador ${username} creado.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
