<<<<<<< HEAD
# SprintForge — Sprint Management Tool

A zero-dependency, browser-based sprint management web app for tech managers.
All data is stored locally in your browser (localStorage). No server needed.

## 🚀 Quick Start

1. Extract the zip
2. Open `index.html` in any modern browser (Chrome, Firefox, Edge, Safari)
3. Sample data is auto-loaded on first run

## ✨ Features

### 📊 Dashboard
- At-a-glance stats: active sprints, team size, task completion, hours
- Sprint progress bars for active sprints
- Resource load indicators (green/yellow/red)

### 🏃 Sprints
- Create / Edit / Delete sprints with name, goal, dates, status
- Kanban board view per sprint: **To Do → In Progress → Done → Blocked**
- Per-task: type (story/bug/task/subtask), priority, assignee, estimated/logged hours, story points
- Expand/collapse sprint cards
- Task detail panel with hour logging and status moves

### 📅 Timeline (Gantt)
- Visual Gantt chart across all sprints
- Sprint bars with resource sub-rows
- Task bars per resource colored by status/priority
- Today marker line
- Clickable task bars to open task detail

### 👥 Resources
- Add team members: name, role, capacity (hrs/day), color
- Per-sprint allocation breakdown with progress bars
- Over/under allocation warnings (green < 85% | yellow < 110% | red > 110%)
- Total load across all sprints

### 📤 Export
- Export all tasks to CSV (sprint, assignee, hours, story points, etc.)

## ⌨️ Keyboard Shortcuts
- `Esc` — Close any open modal

## 🗃️ Data Storage
- All data stored in browser localStorage
- Clear via browser DevTools > Application > LocalStorage > Clear `sf_state`
- Export to CSV as backup

## 📁 File Structure
```
sprint-manager/
├── index.html    — App shell & HTML structure
├── styles.css    — Dark industrial design system
├── app.js        — All state, rendering, CRUD logic
└── README.md     — This file
```

## 🎨 Design
Dark industrial theme · Syne + JetBrains Mono fonts
Orange accent system · Responsive layout

---
Built for tech managers who need to move fast without heavy tooling.
=======
# Sprint-Management
>>>>>>> cce041a9c2a75f24e03772788650281b5486f336
