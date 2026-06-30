# Team Worklog App

A full working web-based task and work-log management application for small teams. It uses React, Tailwind CSS, Node.js, Express, and SQLite, and is designed to deploy cleanly on Render or Hugging Face Spaces.

## Features

- Dashboard with task totals, recent work logs, work hours by member, status chart, and activity timeline
- Multiple projects in one shared app
- Project-specific team member details
- Admin, Manager, and Employee access levels
- Admin/Manager audit log for create, update, and delete history
- Create, edit, delete, search, and filter tasks
- Daily work logs with task, author, date, time spent, progress notes, blockers, and next steps
- Task notes/comments with author, date, and content
- Persistent SQLite storage
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

Create `server/.env` from `server/.env.example` if you want custom settings.

```env
PORT=5000
DATABASE_PATH=./db/team_worklog.sqlite
NODE_ENV=production
```

SQLite is stored at `server/db/team_worklog.sqlite` by default. For Render, use a persistent disk and point `DATABASE_PATH` at that disk, for example `/var/data/team_worklog.sqlite`.

## Render Deployment

You can deploy manually through the Render dashboard or use the included `render.yaml` blueprint.

1. Push this project to GitHub.
2. In Render, create a new **Web Service**.
3. Select the repository.
4. Use these settings:
   - Runtime: Node
   - Build command: `npm install && npm run build && npm run seed`
   - Start command: `npm start`
5. Add environment variables:
   - `NODE_ENV=production`
   - `PORT=10000`
   - `DATABASE_PATH=/var/data/team_worklog.sqlite`
6. Add a Render persistent disk:
   - Mount path: `/var/data`
   - Size: 1 GB is enough for a prototype
7. Deploy.

If you do not add a persistent disk, the app still runs, but SQLite data can disappear when Render restarts the service.

## Hugging Face Spaces Deployment

Use a Docker Space. Rename `Dockerfile.huggingface` to `Dockerfile` before uploading to Hugging Face Spaces.

Hugging Face Spaces may restart containers, so for long-term persistence use persistent storage if available, or move the database to an external managed database.

## PostgreSQL Upgrade Path

The API currently isolates database access in `server/src/db.js` and SQL statements in `server/src/index.js`. To upgrade later:

1. Replace `better-sqlite3` with `pg` or an ORM such as Prisma or Drizzle.
2. Move schema creation into migrations.
3. Set `DATABASE_URL` for PostgreSQL.
4. Keep the existing REST routes and frontend unchanged.

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
  server/              Express API and SQLite database setup
    db/                SQLite database location
    src/
      db.js            Database connection and schema
      index.js         REST API and production static serving
      seed.js          Sample seed data
  package.json         Root scripts for install, dev, build, start, seed
```
