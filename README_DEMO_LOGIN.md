# MN25 Demo Login — Fixed

Use:
- Email: `example@gmail.com`
- Password: `12345678`
- Organisation: `kmclu`
- User ID: optional (`demo-admin` can be entered, but the backend authenticates by email/password)

The frontend now has an explicit local demo-login fallback. With `frontend/.env.local` enabled, if the backend is unreachable, the exact demo credentials create a local demo session instead of showing `Failed to fetch`.

For a real backend-backed account, run `cd backend && npm run prisma:seed-demo` after the database migrations have been applied.
