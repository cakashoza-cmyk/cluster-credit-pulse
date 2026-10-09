import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages project site lives at /cluster-credit-pulse/. Override with VITE_BASE (e.g. '/' for Vercel/Cloudflare, './' for any sub-path).
// All runtime paths (manifest, sw.js, data/*.json, icons) are relative, so they resolve under the base.
export default defineConfig({ plugins: [react()], base: process.env.VITE_BASE || '/cluster-credit-pulse/', build: { outDir: 'dist' } });
