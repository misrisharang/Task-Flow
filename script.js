/* ===========================
   TaskFlow — Task Tracker App
   Data model + all UI logic.
   Persisted to localStorage.
=========================== */

const STORAGE_KEY = "taskflow_data_v1";

const PROJECT_COLORS = ["#4f7cff", "#3ecf8e", "#f5b942", "#ff8b4f", "#ff4f6b", "#b06fff", "#4fd1c5"];

let state = loadState();
let currentProjectId = null;
let currentPriorityFilter = "all";
let calendarCursor = new Date(); // month being viewed
let editingTaskId = null;
let pendingColor = PROJECT_COLORS[0];

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.warn("Could not load saved data", e); }
  return { projects: [], subprojects: [], tasks: [] };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/* ---------- Navigation ---------- */

document.querySelectorAll(".nav-item").forEach(el => {
  el.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    el.classList.add("active");
    currentProjectId = null;
    document.querySelectorAll(".project-list-item").forEach(n => n.classList.remove("active"));
    showView(el.dataset.view);
  });
});

function showView(view) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById("view-" + view).classList.add("active");
  const titles = { dashboard: "Dashboard", calendar: "Calendar", project: "Project" };
  document.getElementById("viewTitle").textContent = titles[view] || "Project";
  if (view === "dashboard") renderDashboard();
  if (view === "calendar") renderCalendar();
}

/* ---------- Sidebar project list ---------- */

function renderProjectList() {
  const list = document.getElementById("projectList");
  list.innerHTML = "";
  if (state.projects.length === 0) {
    list.innerHTML = '<div class="empty-note">No projects yet</div>';
    return;
  }
  state.projects.forEach(p => {
    const tasks = tasksForProject(p.id);
    const item = document.createElement("div");
    item.className = "project-list-item" + (p.id === currentProjectId ? " active" : "");
    item.innerHTML = `
      <span class="project-dot" style="background:${p.color}"></span>
      <span class="proj-name">${escapeHtml(p.name)}</span>
      <span class="proj-count">${tasks.filter(t => t.status === "done").length}/${tasks.length}</span>
    `;
    item.addEventListener("click", () => openProject(p.id));
    list.appendChild(item);
  });
}

function tasksForProject(projectId) {
  const subIds = state.subprojects.filter(s => s.projectId === projectId).map(s => s.id);
  return state.tasks.filter(t => subIds.includes(t.subprojectId));
}

/* ---------- Project view ---------- */

function openProject(id) {
  currentProjectId = id;
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  renderProjectList();
  document.querySelectorAll(".project-list-item").forEach((n, i) => {
    if (state.projects[i] && state.projects[i].id === id) n.classList.add("active");
  });
  showView("project");
  renderProjectView();
}

function renderProjectView() {
  const project = state.projects.find(p => p.id === currentProjectId);
  if (!project) return;
  document.getElementById("viewTitle").textContent = project.name;
  document.getElementById("projTitle").textContent = project.name;
  const subs = state.subprojects.filter(s => s.projectId === project.id);
  const tasks = tasksForProject(project.id);
  const done = tasks.filter(t => t.status === "done").length;
  document.getElementById("projSub").textContent =
    `${subs.length} sub-project${subs.length !== 1 ? "s" : ""} · ${tasks.length} task${tasks.length !== 1 ? "s" : ""} · ${done} done`;

  renderSubprojectGroups(project);
}

function renderSubprojectGroups(project) {
  const container = document.getElementById("subprojectGroups");
  container.innerHTML = "";
  const subs = state.subprojects.filter(s => s.projectId === project.id);
  const statusFilter = document.getElementById("statusFilter").value;

  if (subs.length === 0) {
    container.innerHTML = '<div class="empty-state">No sub-projects yet. Click "+ Sub-project" to create one.</div>';
    return;
  }

  subs.forEach(sub => {
    let tasks = state.tasks.filter(t => t.subprojectId === sub.id);
    if (currentPriorityFilter !== "all") tasks = tasks.filter(t => t.priority === currentPriorityFilter);
    if (statusFilter !== "all") tasks = tasks.filter(t => t.status === statusFilter);

    const block = document.createElement("div");
    block.className = "subproject-block";
    const doneCount = state.tasks.filter(t => t.subprojectId === sub.id && t.status === "done").length;
    const totalCount = state.tasks.filter(t => t.subprojectId === sub.id).length;
    block.innerHTML = `<div class="subproject-title">${escapeHtml(sub.name)} <span class="count">(${doneCount}/${totalCount})</span></div>`;

    if (tasks.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "No tasks match the current filters.";
      block.appendChild(empty);
    } else {
      tasks.forEach(task => block.appendChild(renderTaskRow(task)));
    }
    container.appendChild(block);
  });
}

function renderTaskRow(task) {
  const row = document.createElement("div");
  row.className = "task-row" + (task.status === "done" ? " done" : "");

  const overdue = task.dueDate && task.dueDate < todayISO() && task.status !== "done";

  row.innerHTML = `
    <div class="task-checkbox ${task.status === "done" ? "checked" : ""}" data-id="${task.id}">${task.status === "done" ? "✓" : ""}</div>
    <div class="task-title">${escapeHtml(task.title)}</div>
    <div class="task-meta">
      <span class="priority-badge priority-${task.priority}">${task.priority}</span>
      ${task.dueDate ? `<span class="task-due ${overdue ? "overdue" : ""}">${formatDate(task.dueDate)}</span>` : ""}
    </div>
  `;

  row.querySelector(".task-checkbox").addEventListener("click", (e) => {
    e.stopPropagation();
    task.status = task.status === "done" ? "todo" : "done";
    saveState();
    renderProjectView();
  });

  row.addEventListener("click", () => openTaskModal(task));
  return row;
}

/* ---------- Filters ---------- */

document.querySelectorAll(".chip").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    currentPriorityFilter = chip.dataset.priority;
    renderProjectView();
  });
});

document.getElementById("statusFilter").addEventListener("change", renderProjectView);

/* ---------- Modals: generic ---------- */

function openModal(id) { document.getElementById(id).classList.add("open"); }
function closeModal(id) { document.getElementById(id).classList.remove("open"); }

document.querySelectorAll("[data-close]").forEach(btn => {
  btn.addEventListener("click", () => closeModal(btn.dataset.close));
});
document.querySelectorAll(".modal-overlay").forEach(ov => {
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.classList.remove("open"); });
});

/* ---------- Project modal ---------- */

document.getElementById("btnAddProject").addEventListener("click", () => {
  document.getElementById("inputProjectName").value = "";
  renderColorPicker();
  openModal("modalProject");
});

function renderColorPicker() {
  const wrap = document.getElementById("colorPicker");
  wrap.innerHTML = "";
  pendingColor = PROJECT_COLORS[0];
  PROJECT_COLORS.forEach((c, i) => {
    const sw = document.createElement("div");
    sw.className = "color-swatch" + (i === 0 ? " selected" : "");
    sw.style.background = c;
    sw.addEventListener("click", () => {
      pendingColor = c;
      wrap.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("selected"));
      sw.classList.add("selected");
    });
    wrap.appendChild(sw);
  });
}

document.getElementById("saveProject").addEventListener("click", () => {
  const name = document.getElementById("inputProjectName").value.trim();
  if (!name) return;
  state.projects.push({ id: uid(), name, color: pendingColor, createdAt: todayISO() });
  saveState();
  closeModal("modalProject");
  renderProjectList();
  renderDashboard();
});

/* ---------- Sub-project modal ---------- */

document.getElementById("btnAddSubproject").addEventListener("click", () => {
  document.getElementById("inputSubprojectName").value = "";
  openModal("modalSubproject");
});

document.getElementById("saveSubproject").addEventListener("click", () => {
  const name = document.getElementById("inputSubprojectName").value.trim();
  if (!name || !currentProjectId) return;
  state.subprojects.push({ id: uid(), projectId: currentProjectId, name });
  saveState();
  closeModal("modalSubproject");
  renderProjectView();
});

/* ---------- Task modal ---------- */

document.getElementById("btnAddTask").addEventListener("click", () => openTaskModal(null));

function openTaskModal(task) {
  editingTaskId = task ? task.id : null;
  document.getElementById("taskModalTitle").textContent = task ? "Edit Task" : "New Task";
  document.getElementById("inputTaskTitle").value = task ? task.title : "";
  document.getElementById("inputTaskDesc").value = task ? (task.description || "") : "";
  document.getElementById("inputTaskPriority").value = task ? task.priority : "medium";
  document.getElementById("inputTaskDue").value = task ? (task.dueDate || "") : "";
  document.getElementById("inputTaskStatus").value = task ? task.status : "todo";
  document.getElementById("deleteTask").style.display = task ? "inline-block" : "none";

  const subSelect = document.getElementById("inputTaskSubproject");
  subSelect.innerHTML = "";
  const subs = state.subprojects.filter(s => s.projectId === currentProjectId);
  subs.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    subSelect.appendChild(opt);
  });
  if (task) subSelect.value = task.subprojectId;

  if (subs.length === 0) {
    alert("Create a sub-project first before adding tasks.");
    return;
  }
  openModal("modalTask");
}

document.getElementById("saveTask").addEventListener("click", () => {
  const title = document.getElementById("inputTaskTitle").value.trim();
  if (!title) return;
  const data = {
    title,
    description: document.getElementById("inputTaskDesc").value.trim(),
    subprojectId: document.getElementById("inputTaskSubproject").value,
    priority: document.getElementById("inputTaskPriority").value,
    dueDate: document.getElementById("inputTaskDue").value || null,
    status: document.getElementById("inputTaskStatus").value,
  };

  if (editingTaskId) {
    const t = state.tasks.find(t => t.id === editingTaskId);
    Object.assign(t, data);
  } else {
    state.tasks.push({ id: uid(), ...data, createdAt: todayISO() });
  }
  saveState();
  closeModal("modalTask");
  renderProjectView();
  renderProjectList();
});

document.getElementById("deleteTask").addEventListener("click", () => {
  if (!editingTaskId) return;
  state.tasks = state.tasks.filter(t => t.id !== editingTaskId);
  saveState();
  closeModal("modalTask");
  renderProjectView();
  renderProjectList();
});

/* ---------- Dashboard ---------- */

let chartOverall, chartPriority;

function renderDashboard() {
  const allTasks = state.tasks;
  const total = allTasks.length;
  const done = allTasks.filter(t => t.status === "done").length;
  const inProgress = allTasks.filter(t => t.status === "in-progress").length;
  const overdue = allTasks.filter(t => t.dueDate && t.dueDate < todayISO() && t.status !== "done").length;

  document.getElementById("statTotal").textContent = total;
  document.getElementById("statDone").textContent = done;
  document.getElementById("statProgress").textContent = inProgress;
  document.getElementById("statOverdue").textContent = overdue;

  const pct = total ? Math.round((done / total) * 100) : 0;
  document.getElementById("overallPct").textContent = pct + "%";

  // Overall doughnut
  const ctx1 = document.getElementById("chartOverall").getContext("2d");
  if (chartOverall) chartOverall.destroy();
  chartOverall = new Chart(ctx1, {
    type: "doughnut",
    data: {
      labels: ["Done", "Remaining"],
      datasets: [{ data: [done, total - done], backgroundColor: ["#3ecf8e", "#232b3d"], borderWidth: 0 }]
    },
    options: {
      cutout: "72%",
      plugins: { legend: { display: false } }
    }
  });

  // Priority bar
  const byPriority = { low: 0, medium: 0, high: 0, urgent: 0 };
  allTasks.forEach(t => { if (byPriority[t.priority] !== undefined) byPriority[t.priority]++; });
  const ctx2 = document.getElementById("chartPriority").getContext("2d");
  if (chartPriority) chartPriority.destroy();
  chartPriority = new Chart(ctx2, {
    type: "bar",
    data: {
      labels: ["Low", "Medium", "High", "Urgent"],
      datasets: [{
        data: [byPriority.low, byPriority.medium, byPriority.high, byPriority.urgent],
        backgroundColor: ["#4fb0ff", "#f5b942", "#ff8b4f", "#ff4f6b"],
        borderRadius: 6
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#8b93a7" } },
        y: { grid: { color: "#232b3d" }, ticks: { color: "#8b93a7", precision: 0 } }
      }
    }
  });

  renderProjectProgress();
  renderUpcoming();
}

function renderProjectProgress() {
  const wrap = document.getElementById("projectProgressList");
  wrap.innerHTML = "";
  if (state.projects.length === 0) {
    wrap.innerHTML = '<div class="empty-note">Create a project to see progress here.</div>';
    return;
  }
  state.projects.forEach(p => {
    const tasks = tasksForProject(p.id);
    const done = tasks.filter(t => t.status === "done").length;
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    const row = document.createElement("div");
    row.className = "ppl-row";
    row.innerHTML = `
      <div class="ppl-top">
        <span class="ppl-name"><span class="project-dot" style="background:${p.color}"></span>${escapeHtml(p.name)}</span>
        <span class="ppl-pct">${pct}% (${done}/${tasks.length})</span>
      </div>
      <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%; background:${p.color}"></div></div>
    `;
    wrap.appendChild(row);
  });
}

function renderUpcoming() {
  const wrap = document.getElementById("upcomingList");
  wrap.innerHTML = "";
  const today = todayISO();
  const withDates = state.tasks
    .filter(t => t.dueDate && t.status !== "done")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  if (withDates.length === 0) {
    wrap.innerHTML = '<div class="empty-note">No upcoming deadlines.</div>';
    return;
  }

  withDates.slice(0, 12).forEach(t => {
    const isOverdue = t.dueDate < today;
    const isToday = t.dueDate === today;
    const item = document.createElement("div");
    item.className = "upcoming-item" + (isOverdue ? " overdue" : isToday ? " today" : "");
    item.innerHTML = `
      <span>${escapeHtml(t.title)}</span>
      <span class="u-date">${isOverdue ? "Overdue · " : ""}${formatDate(t.dueDate)}</span>
    `;
    wrap.appendChild(item);
  });
}

/* ---------- Calendar ---------- */

function renderCalendar() {
  const label = document.getElementById("calMonthLabel");
  const grid = document.getElementById("calendarGrid");
  grid.innerHTML = "";

  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  label.textContent = calendarCursor.toLocaleString("default", { month: "long", year: "numeric" });

  ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].forEach(d => {
    const el = document.createElement("div");
    el.className = "cal-dow";
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = todayISO();

  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement("div");
    empty.className = "cal-cell empty";
    grid.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const cell = document.createElement("div");
    cell.className = "cal-cell" + (dateStr === today ? " today" : "");
    cell.innerHTML = `<div class="cal-date">${d}</div>`;

    const tasksToday = state.tasks.filter(t => t.dueDate === dateStr);
    tasksToday.forEach(t => {
      const tag = document.createElement("div");
      tag.className = "cal-task priority-" + t.priority;
      tag.textContent = t.title;
      tag.title = t.title;
      tag.addEventListener("click", () => {
        const proj = state.subprojects.find(s => s.id === t.subprojectId);
        if (proj) openProject(proj.projectId);
        setTimeout(() => openTaskModal(t), 50);
      });
      cell.appendChild(tag);
    });

    grid.appendChild(cell);
  }
}

document.getElementById("calPrev").addEventListener("click", () => {
  calendarCursor.setMonth(calendarCursor.getMonth() - 1);
  renderCalendar();
});
document.getElementById("calNext").addEventListener("click", () => {
  calendarCursor.setMonth(calendarCursor.getMonth() + 1);
  renderCalendar();
});

/* ---------- Export / Import ---------- */

document.getElementById("btnExport").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `taskflow-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("importFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = JSON.parse(evt.target.result);
      if (!data.projects || !data.subprojects || !data.tasks) throw new Error("Invalid format");
      state = data;
      saveState();
      renderProjectList();
      renderDashboard();
      currentProjectId = null;
      showView("dashboard");
      document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.view === "dashboard"));
      alert("Data imported successfully.");
    } catch (err) {
      alert("Could not import file: " + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

/* ---------- Helpers ---------- */

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("default", { month: "short", day: "numeric" });
}

/* ---------- Init ---------- */

document.getElementById("todayDate").textContent = new Date().toLocaleDateString("default", {
  weekday: "long", year: "numeric", month: "long", day: "numeric"
});

renderProjectList();
renderDashboard();
