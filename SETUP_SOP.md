# Complaudi Setup - Standard Operating Procedure (SOP)

Welcome to the **Complaudi (India Compliance Toolkit)** project! This guide is written to be as simple as possible so anyone can set up the project on their computer from scratch.

---

## 🛠️ Step 1: Prerequisites
Before you begin, make sure you have the following installed on your computer:
- **Node.js** (version 20 or higher) - [Download here](https://nodejs.org/)
- **Git** - [Download here](https://git-scm.com/)
- *(Optional but recommended)* **Docker** - If you want to run the database locally instead of using a cloud database.

---

## 📦 Step 2: Install Dependencies
Open your terminal, navigate to the project folder, and install all the required Node packages:

```bash
# This installs all the backend and frontend packages required to run the app
npm install
```

---

## 🗄️ Step 3: Database & Environment Setup
The application needs a PostgreSQL database to run. You have two choices: **Local (Docker)** or **Cloud (Supabase)**.

First, copy the example environment file:
```bash
cp .env.example .env
```

Now, open the `.env` file in your code editor. You will need to update the `DATABASE_URL` and `DIRECT_URL`.

### Option A: Using Local Database (Easiest for quick testing)
If you have Docker installed, you can spin up a local database instantly.
1. Run this command in your terminal:
   ```bash
   docker compose up -d
   ```
2. In your `.env` file, ensure your database URLs look exactly like this:
   ```env
   DATABASE_URL="postgresql://postgres:postgres@localhost:5433/compliance?schema=public"
   DIRECT_URL="postgresql://postgres:postgres@localhost:5433/compliance?schema=public"
   ```

### Option B: Using Supabase (Recommended for real data/production)
If you want to use a live Supabase project:
1. Go to [Supabase](https://supabase.com) and create a project.
2. Save your Database Password securely.
3. In your Supabase Dashboard -> **Project Settings** -> **Database**, grab the Node.js Connection Strings (make sure "Use connection pooling" is checked).
4. In your `.env` file, update the URLs like this:
   ```env
   DATABASE_URL="postgresql://postgres.[YOUR-PROJECT-ID]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=10"
   DIRECT_URL="postgresql://postgres.[YOUR-PROJECT-ID]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"
   ```

---

## 🏗️ Step 4: Create Database Tables (Migrations)
Now that your database is connected, we need to create the tables required by Complaudi. Run this command:

```bash
npm run prisma:migrate
```
*If this command succeeds, your database is fully set up!*

---

## 🚀 Step 5: Start the Project!
You are now ready to run the application. We have a simple command that starts **both** the backend API and the frontend Web dashboard at the same time:

```bash
npm run dev:all
```

**Where to view the app:**
- 🌐 **Web Dashboard (Frontend):** [http://localhost:5173](http://localhost:5173)
- ⚙️ **API (Backend):** [http://localhost:4000](http://localhost:4000)

---

## ❓ Troubleshooting Common Errors

- **Error: `Can't reach database server`**
  - *Fix:* Your `.env` database URLs are wrong. If using Supabase, make sure you are using the "Pooler" URL (port 6543/5432) and not the IPv6 direct URL. If using Docker, ensure Docker is actually running.

- **Error: `Authentication failed against database server`**
  - *Fix:* You typed the wrong database password in your `.env` file. (Remember to URL-encode special characters if necessary, though it's easier to just use alphanumeric passwords).
