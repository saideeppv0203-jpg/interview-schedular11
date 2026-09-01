# Interview Scheduler

A booking site for interview slots across two cabins.

- Students register (name, domain, phone), then log back in with just their
  phone number.
- They pick a date and a free time slot in Cabin 1 or Cabin 2, entering the
  company name and interview round.
- Once a slot is taken, it shows "Full" for everyone else immediately.
- Admins log in and approve ("Give access") or reject each request, and see
  a running count of total / pending / approved / rejected interviews.

Stack: a React (Vite) frontend and a small Node/Express backend that stores
data in SQLite on disk. No external accounts or paid services required to
run it.

## Project layout

```
interview-scheduler/
├── client/     React frontend (Vite)
├── server/     Express API + data.json storage
└── package.json  convenience scripts for local dev
```

## Run it locally

You'll need Node.js 18+ installed.

```bash
# from the project root
npm run install-all
cp server/.env.example server/.env
# edit server/.env: set ADMIN_PASSWORD and ADMIN_TOKEN to your own values

npm run dev
```

This starts the API on **http://localhost:4000** and the frontend on
**http://localhost:5173** (Vite proxies `/api` calls to the backend
automatically). Open the Vite URL in your browser.

## Configuration

All admin settings live in `server/.env` (copy from `server/.env.example`):

| Variable        | Purpose                                                        |
|------------------|-----------------------------------------------------------------|
| `ADMIN_EMAIL`    | Email required to log in to the admin dashboard                |
| `ADMIN_PASSWORD` | Password required to log in to the admin dashboard              |
| `ADMIN_TOKEN`    | Secret used to authorize approve/reject requests. Generate one with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `PORT`           | Port the server listens on (defaults to 4000, most hosts override this automatically) |

**Change `ADMIN_PASSWORD` and `ADMIN_TOKEN` before deploying** — don't ship
the example values.

## Building for production

```bash
npm run build   # builds the React app into client/dist
npm start       # starts the Express server, which serves client/dist + the API
```

One server process handles everything — no separate frontend host needed.

## Deploying it online

The simplest option is a host that runs a persistent Node process, such as
**Render** or **Railway**:

1. Push this project to a GitHub repo.
2. Create a new **Web Service** on Render (or Railway) pointing at that repo.
3. Build command: `npm install && npm run build` (the build script installs the nested server and client dependencies)
4. Start command: `node server/index.js`
5. Add a **persistent disk** on Render mounted at `/var/data` and set `DATA_DIR=/var/data`.
   The included `render.yaml` configures this automatically for Render Blueprint deployments.
6. Add the environment variables from the table above in the host's dashboard
   (don't commit `.env` to git — it's already git-ignored).
7. Deploy. The URL the host gives you is your live site.

### Important: data persistence

This project stores data in SQLite (`server/data.sqlite` by default, or a
custom `DB_PATH` if you set one). In production, set `DATA_DIR` to the path of
a persistent disk (Render's paid persistent disk mounted at `/var/data`, or
Railway's volume). The server creates the data directory when it starts, and
students/bookings remain available after deployments.

If you deploy to a platform with an **ephemeral filesystem** (e.g. Render's
free tier without an added disk, or serverless platforms like Vercel), the
database file will reset whenever the service restarts or redeploys —
students and bookings would disappear. If that's a risk for you, two options:

- Add a small persistent disk on your host (cheap, usually ~$1/month), or
- Swap the JSON file for a real hosted database (e.g. a free-tier Postgres
  on Supabase or Neon, or MongoDB Atlas). Happy to help make that change if
  you tell me which host/database you'd like to use.

## Security note

Admin login is checked against `ADMIN_EMAIL` / `ADMIN_PASSWORD` on the
server, and only requests carrying the correct `ADMIN_TOKEN` can approve or
reject bookings — this is a meaningful step up from doing the check in the
browser, but it's still a single shared secret rather than per-user
accounts. Good enough for an internal/class tool; if this needs to hold up
to real scrutiny (multiple admins, audit trails, password resets), it would
need a proper auth system.
