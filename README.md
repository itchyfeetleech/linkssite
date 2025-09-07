Project restructure summary

- New stack: Next.js 15 (App Router), TypeScript, Tailwind CSS.
- Frontend and backend unified under `web/` with API routes.
- Existing static site preserved in `legacy/` for reference.
- Assets moved to `web/public/assets`.
- Links centralized in `web/src/data/links.ts` and exposed via `GET /api/links`.
- Fonts optimized via `next/font` (Manrope, Nabla).
- Tooling: ESLint (flat config), Prettier, EditorConfig, typecheck script.

Local development

- Install dependencies: `cd web && npm install`
- Dev server: `npm run dev` (http://localhost:3000)
- Type check: `npm run typecheck`
- Lint: `npm run lint`
- Format: `npm run format`
- Build: `npm run build` and `npm start`

Next steps (optional)

- Add Prisma + SQLite/Postgres for dynamic links and admin editing.
- Add NextAuth for protected admin routes.
- Add click analytics (API route + DB table).
- Containerize with Dockerfile and CI workflow.
