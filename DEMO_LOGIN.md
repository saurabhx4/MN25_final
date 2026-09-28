# MN25 Demo Login

Demo credentials:
- Email: `example@gmail.com`
- Password: `12345678`
- Organization: `kmclu`

## Backend-backed login
If PostgreSQL, Redis and the MN25 backend are running, create the persistent demo account with:

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev
npm run prisma:seed-demo
npm run dev
```

Run the frontend separately:

```bash
cd frontend
npm install
npm run dev
```

## Local demo fallback
The included `frontend/.env.local` enables the explicit demo fallback. If the backend is unavailable, the exact demo credentials above still enter the dashboard in local demo mode instead of displaying `Failed to fetch`. This fallback is for local demonstration only and does not fabricate production backend data.
