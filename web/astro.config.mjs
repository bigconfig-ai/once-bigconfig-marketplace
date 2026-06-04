import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  outDir: '../pocketbase/pb_public',
  server: {
    port: Number(process.env.PORT) || 4321,
    allowedHosts: true,
  },
});
