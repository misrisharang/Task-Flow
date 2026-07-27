# TaskFlow — Project & Task Tracker

A single-page task tracker: Project → Sub-project → Task, with priority levels (low/medium/high/urgent), due dates, a calendar view, and a progress dashboard. No backend, no build step — just three files.

## Files

- `index.html` — page structure
- `styles.css` — dark theme styling
- `script.js` — all app logic

Data is saved in the browser's local storage, per device/browser. Use the **Export data** / **Import data** buttons in the sidebar to back up or move your data between devices or browsers.

## Run locally

Just open `index.html` in a browser. No server or install needed.

## Publish on GitHub Pages

1. Create a new GitHub repo (e.g. `task-tracker`).
2. Add these three files to the repo root and commit:
   ```
   git init
   git add index.html styles.css script.js README.md
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/task-tracker.git
   git push -u origin main
   ```
3. On GitHub: go to **Settings → Pages**.
4. Under **Source**, choose **Deploy from a branch**, pick branch `main`, folder `/ (root)`, then **Save**.
5. Your tracker will be live in a minute or two at:
   `https://<your-username>.github.io/task-tracker/`

Note: since data is stored in the browser's local storage, each browser/device you use it from will have its own separate data. Use Export/Import to sync between them.

## Features

- Create projects, sub-projects within each, and tasks within each sub-project
- Priority filter: low, medium, high, urgent
- Status: to do, in progress, done
- Calendar view showing tasks by due date, click a task to open and edit it
- Dashboard: total/completed/in-progress/overdue counts, overall completion ring, tasks-by-priority chart, per-project progress bars, upcoming and overdue deadlines list
