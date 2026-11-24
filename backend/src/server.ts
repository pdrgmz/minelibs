import { buildApp } from './app';
import { env } from './config';
import { prisma } from './db';
import { prewarmAssets } from './routes/assets';

async function main(): Promise<void> {
  const app = await buildApp();
  const shutdown = async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  // No bloquea el arranque: el visor descargará lo que falte bajo demanda.
  void prewarmAssets();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
