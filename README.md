# Subnet Sculptor

An entirely frontend, visual subnet calculator built with React, TypeScript, Vite, and Framer Motion. Enter any IPv4 CIDR, choose how many times to split it, and watch nested subnet boxes divide with smooth, cell-division-like animations. Perfect for GitHub Pages or CDN hosting.

## Features
- Interactive IPv4 CIDR input with validation feedback
- Adjustable split depth with animated nested boxes
- Quick CIDR presets and state remembered in localStorage
- Smooth, spring-based transitions via Framer Motion
- Modern neon-on-dark aesthetic, responsive grid layout

## Getting started
```bash
npm install
npm run dev    # start locally at http://localhost:5173
npm run build  # produce static assets for CDN/GitHub Pages
```

Serve the `dist/` folder (after `npm run build`) from any static host.

## Notes
- All logic is client-side; no backend required.
- If you enter an invalid CIDR, an inline error message appears.
