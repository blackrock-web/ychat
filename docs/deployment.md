# YChat Production Deployment & Cloud Upgrade Guide

## 1. Local Development Deployment

Run locally with Docker Compose for PostgreSQL or the embedded storage engine:

```bash
# 1. Clone repository and install dependencies
npm install

# 2. Start PostgreSQL via Docker Compose
docker compose up -d postgres

# 3. Configure environment
cp .env.example .env

# 4. Start YChat backend + web client
npm run dev
```

The web application and API become accessible at `http://localhost:3000`.

---

## 2. Docker Compose Specification (`docker-compose.yml`)

Included at the project root:
- **`ychat-backend`**: Node.js container executing `npm start`.
- **`postgres`**: Official `postgres:16-alpine` database with initialization script.

---

## 3. Production Cloud Upgrade Path (e.g., Render + Supabase)

### Step 1: Managed Database (Supabase / AWS RDS)
1. Provision a PostgreSQL instance on Supabase.
2. Run `schema.sql` migration script located in `server/schema.sql`.
3. Obtain connection URI:
   `postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres?sslmode=require`

### Step 2: Backend Container (Render / Cloud Run)
1. Deploy as a Web Service on Render or Google Cloud Run.
2. Configure Environment Variables:
   - `DATABASE_URL`: Your Supabase connection string.
   - `JWT_SECRET`: A high-entropy 256-bit random string.
   - `ENVIRONMENT`: `production`.
   - `PORT`: `3000`.
3. Set health check path to `/api/v1/health`.

### Step 3: Client Applications Configuration
Clients only require updating:
- `API_BASE_URL`: `https://api.ychat.example.com`
- `WS_BASE_URL`: `wss://api.ychat.example.com/ws`

Zero client application code changes are required to migrate from local dev to cloud production!
