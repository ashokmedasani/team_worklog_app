# Team Worklog App

A full working web-based task and work-log management application for small teams. It uses React, Tailwind CSS, Node.js, Express, SQLite for local development, and PostgreSQL for Render deployment.

## Features

- Dashboard with task totals, recent work logs, work hours by member, status chart, and activity timeline
- Multiple projects in one shared app
- Project-specific team member details
- Admin, Manager, and Employee access levels
- Admin/Manager audit log for create, update, and delete history
- Create, edit, delete, search, and filter tasks
- Daily work logs with task, author, date, time spent, progress notes, blockers, and next steps
- Task notes/comments with author, date, and content
- Persistent database storage with local SQLite or hosted PostgreSQL
- Team member selector with no complex authentication
- CSV export for tasks and work logs
- Mobile responsive layout
- Seed data included

The app now starts empty by default so you can create your own projects, teams, tasks, logs, and notes.

## Local Setup

Prerequisites: Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open the app at `http://localhost:5000`.

The root install command installs the backend and frontend dependencies. The dev command creates the default admin if needed, builds the frontend, and serves the complete app from Express.

Default first login:

```text
Username: admin
Password: admin123
```

Change this password from **Users** after logging in.

For hot-reload frontend development, you can try `npm run dev:split`, which starts Express and Vite separately. The default `npm run dev` is the most reliable local command.

## Typical Workflow

1. Create a project in **Projects**.
2. Select that project from the top project selector.
3. Add project team members in **Team** and choose their access level.
4. Create tasks under that project in **Tasks**.
5. Log work against project tasks in **Work Logs**.
6. Add task comments or missing details in **Notes**.

## Access Levels

- `Admin`: controls the workspace. Admin can create/edit projects, add employees, assign access levels, delete records, and view audit logs.
- `Manager`: can manage assigned project work such as tasks, work logs, and notes, but cannot add employees or change access.
- `Employee`: can create and edit ordinary project work, but cannot delete records, add users, change access, or view audit logs.

Everyone uses the same login page. The app detects access from the logged-in user account. Login users are managed by Admin in **Users**. Project team members are managed separately in **Team** for assignment and project details.

## Audit Log

The **Audit** tab is visible only to Admin users. It records create, update, and delete actions. Deletes store a JSON snapshot of the deleted record, including related task logs/notes when a task is deleted.

## Time Entry

Work logs accept time in several formats:

- `4h25m` for 4 hours and 25 minutes
- `4h` for 4 hours
- `25m` for 25 minutes
- `4:25` for 4 hours and 25 minutes
- `4.5` for 4.5 hours

## One-Command Production Run

After installing dependencies:

```bash
npm run build
npm start
```

Then open `http://localhost:5000`. Express serves the built React app and API from the same process.

## Environment Variables

Create `.env` from `.env.example` if you want custom settings.

```env
PORT=5000
DATABASE_URL=
APP_SECRET=change-this-to-a-long-random-secret
NODE_ENV=production
```

If `DATABASE_URL` is empty, the app uses SQLite at `server/db/team_worklog.sqlite`. If `DATABASE_URL` is set, the app uses PostgreSQL. On Render, paste the Render PostgreSQL **Internal Database URL** into the web service environment variable named `DATABASE_URL`.

## Render Deployment

You can deploy manually through the Render dashboard or use the included `render.yaml` blueprint.

1. Create a Render PostgreSQL database.
2. Copy the **Internal Database URL** from the database Connections page.
3. Create a new Render **Web Service** from this GitHub repository.
4. Use these settings:
   - Runtime: Node
   - Build command: `npm install && npm run build && npm run seed`
   - Start command: `npm start`
5. Add environment variables:
   - `NODE_ENV=production`
   - `PORT=10000`
   - `DATABASE_URL=<paste your Render Internal Database URL>`
   - `APP_SECRET=<any long random secret>`
6. Deploy.

Use the **Internal Database URL** when the web service and database are both on Render. The External Database URL is mainly for connecting from your computer or another host.

Render free web services can sleep after inactivity. Your data will stay in PostgreSQL, but the first request after sleep may take a little longer.

## Hugging Face Spaces Deployment

Use a Docker Space. Rename `Dockerfile.huggingface` to `Dockerfile` before uploading to Hugging Face Spaces.

Hugging Face Spaces may restart containers, so for long-term persistence use persistent storage if available, or move the database to an external managed database.

## Database Mode

- Local development: leave `DATABASE_URL` empty and SQLite is used automatically.
- Render deployment: set `DATABASE_URL` and PostgreSQL is used automatically.
- The first deploy runs `npm run seed`, which creates the first admin account if no Admin exists.

Default first login:

```text
Username: admin
Password: admin123
```

Change this password from **Users** after logging in.

## API Endpoints

- `GET /api/dashboard`
- `GET /api/tasks`
- `POST /api/tasks`
- `PUT /api/tasks/:id`
- `DELETE /api/tasks/:id`
- `GET /api/work-logs`
- `POST /api/work-logs`
- `PUT /api/work-logs/:id`
- `DELETE /api/work-logs/:id`
- `GET /api/notes`
- `POST /api/notes`
- `PUT /api/notes/:id`
- `DELETE /api/notes/:id`
- `GET /api/export/tasks.csv`
- `GET /api/export/work-logs.csv`

## Project Structure

```text
team-worklog-app/
  client/              React + Tailwind frontend
  server/              Express API and database setup
    db/                SQLite database location
    src/
      db.js            Database connection and schema
      index.js         REST API and production static serving
      seed.js          Sample seed data
  package.json         Root scripts for install, dev, build, start, seed
```
