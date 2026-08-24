/* ===========================
   TaskFlow — Task Tracker App
   Data model + all UI logic.
   Persisted to localStorage.

   IMPORTANT: the storage key and core field names
   (project.id/name/color, subproject.id/projectId/name,
   task.id/subprojectId/title/description/priority/dueDate/status)
   must never change or be renamed — existing users' saved
   data depends on this shape. New optional fields (e.g.
   project.archived) are added with safe defaults via
   migrateState() so old data keeps working untouched.
=========================== */

const STORAGE_KEY = "taskflow_data_v1";

const PROJECT_COLORS = ["#4f7cff", "#3ecf8e", "#f5b942", "#ff8b4f", "#ff4f6b", "#b06fff", "#4fd1c5"];

let state = loadState();
let currentProjectId = null;
let currentPriorityFilter = "all";
let calendarCursor = new Date(); // month being viewed
let editingTaskId = null;
let editingProjectId = null;
let editingSubprojectId = null;
let pendingColor = PROJECT_COLORS[0];
let draggedTaskId = null;
let preSearchView = "dashboard";

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return migrateState(JSON.parse(raw));
  } catch (e) { console.warn("Could not load saved data", e); }
  return { projects: [], subprojects: [], tasks: [] };
}

// Backfills new optional fields on old data without touching existing values.
function migrateState(data) {
  data.projects = data.projects || [];
  data.subprojects = data.subprojects || [];
  data.tasks = data.tasks || [];
  data.projects.forEach(p => {
    if (typeof p.archived !== "boolean") p.archived = false;
  });
  data.tasks.forEach(t => {
    if (typeof t.archived !== "boolean") t.archived = false;
    // Unknown for pre-existing done tasks (we can't know when they were actually completed) —
    // left null on purpose so the "Completed (7 days)" stat doesn't guess. It'll start counting
    // correctly for any task marked done from here on.
    if (typeof t.completedAt === "undefined") t.completedAt = null;
  });
  return data;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Formats a Date as YYYY-MM-DD using its LOCAL time zone fields.
// (Deliberately not toISOString(), which is UTC-based and gives the wrong
// day for anyone ahead of UTC, e.g. IST, once local time passes midnight
// but UTC hasn't rolled over yet — this previously caused "today",
// "overdue", and the 7-day completed count to be off by a day.)
function toLocalISO(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayISO() {
  return toLocalISO(new Date());
}

/* ---------- Navigation ---------- */

document.querySelectorAll(".nav-item").forEach(el => {
  el.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    el.classList.add("active");
    currentProjectId = null;
    document.getElementById("globalSearch").value = "";
    document.querySelectorAll(".project-list-item").forEach(n => n.classList.remove("active"));
    showView(el.dataset.view);
  });
});

function showView(view) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById("view-" + view).classList.add("active");
  const titles = { dashboard: "Dashboard", calendar: "Calendar", project: "Project", search: "Search" };
  document.getElementById("viewTitle").textContent = titles[view] || "Project";
  if (view === "dashboard") renderDashboard();
  if (view === "calendar") renderCalendar();
  if (view !== "search") preSearchView = view;
}

/* ---------- Sidebar project list ---------- */

function renderProjectList() {
  const list = document.getElementById("projectList");
  const archivedList = document.getElementById("archivedList");
  const archivedSection = document.getElementById("archivedSection");
  const archivedCount = document.getElementById("archivedCount");

  list.innerHTML = "";
  archivedList.innerHTML = "";

  const active = state.projects.filter(p => !p.archived);
  const archived = state.projects.filter(p => p.archived);

  if (active.length === 0) {
    list.innerHTML = '<div class="empty-note">No projects yet</div>';
  } else {
    active.forEach(p => list.appendChild(buildProjectListItem(p)));
  }

  archived.forEach(p => archivedList.appendChild(buildProjectListItem(p)));
  archivedCount.textContent = archived.length;
  archivedSection.style.display = archived.length ? "block" : "none";
}

function buildProjectListItem(p) {
  const tasks = tasksForProject(p.id);
  const item = document.createElement("div");
  item.className = "project-list-item" + (p.id === currentProjectId ? " active" : "");
  item.innerHTML = `
    <span class="project-dot" style="background:${p.color}"></span>
    <span class="proj-name">${escapeHtml(p.name)}</span>
    <span class="proj-count">${tasks.filter(t => t.status === "done").length}/${tasks.length}</span>
    <span class="proj-actions">
      <button class="icon-btn" data-action="edit" title="Rename / recolor">✎</button>
      <button class="icon-btn" data-action="archive" title="${p.archived ? "Unarchive" : "Archive"}">${p.archived ? "⤴" : "🗄"}</button>
      <button class="icon-btn danger" data-action="delete" title="Delete project">🗑</button>
    </span>
  `;
  item.addEventListener("click", () => openProject(p.id));
  item.querySelector('[data-action="edit"]').addEventListener("click", (e) => {
    e.stopPropagation();
    openProjectModal(p);
  });
  item.querySelector('[data-action="archive"]').addEventListener("click", (e) => {
    e.stopPropagation();
    toggleArchiveProject(p.id);
  });
  item.querySelector('[data-action="delete"]').addEventListener("click", (e) => {
    e.stopPropagation();
    deleteProject(p.id);
  });
  return item;
}

document.getElementById("archivedToggle").addEventListener("click", () => {
  const list = document.getElementById("archivedList");
  const caret = document.getElementById("archivedCaret");
  const isHidden = list.style.display === "none";
  list.style.display = isHidden ? "block" : "none";
  caret.textContent = isHidden ? "▴" : "▾";
});

function tasksForProject(projectId) {
  const subIds = state.subprojects.filter(s => s.projectId === projectId).map(s => s.id);
  return state.tasks.filter(t => subIds.includes(t.subprojectId));
}

/* ---------- Project view ---------- */

function openProject(id) {
  currentProjectId = id;
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.getElementById("globalSearch").value = "";
  showView("project");
  renderProjectView(); // also calls renderProjectList(), which highlights the active project by id
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
    `${subs.length} sub-project${subs.length !== 1 ? "s" : ""} · ${tasks.length} task${tasks.length !== 1 ? "s" : ""} · ${done} done${project.archived ? " · Archived" : ""}`;

  document.getElementById("btnArchiveProject").textContent = project.archived ? "⤴" : "🗄";
  document.getElementById("btnArchiveProject").title = project.archived ? "Unarchive project" : "Archive project";

  renderSubprojectGroups(project);
  renderProjectList();
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
    // Archived tasks are hidden from the active list by default (but stay in the data,
    // so dashboard/project counts are unaffected).
    let tasks = state.tasks.filter(t => t.subprojectId === sub.id && !t.archived);
    if (currentPriorityFilter !== "all") tasks = tasks.filter(t => t.priority === currentPriorityFilter);
    if (statusFilter !== "all") tasks = tasks.filter(t => t.status === statusFilter);

    const archivedTasks = state.tasks.filter(t => t.subprojectId === sub.id && t.archived);

    const block = document.createElement("div");
    block.className = "subproject-block";
    const doneCount = state.tasks.filter(t => t.subprojectId === sub.id && t.status === "done").length;
    const totalCount = state.tasks.filter(t => t.subprojectId === sub.id).length;
    block.innerHTML = `
      <div class="subproject-title">
        <span>${escapeHtml(sub.name)}</span>
        <span class="count">(${doneCount}/${totalCount})</span>
        <button class="icon-btn" data-action="edit-sub" title="Rename sub-project">✎</button>
        <button class="icon-btn danger" data-action="delete-sub" title="Delete sub-project">🗑</button>
      </div>
      <div class="subproject-tasks"></div>
    `;
    block.querySelector('[data-action="edit-sub"]').addEventListener("click", () => openSubprojectModal(sub));
    block.querySelector('[data-action="delete-sub"]').addEventListener("click", () => deleteSubproject(sub.id));

    const taskContainer = block.querySelector(".subproject-tasks");

    if (tasks.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "No tasks match the current filters.";
      taskContainer.appendChild(empty);
    } else {
      tasks.forEach(task => taskContainer.appendChild(renderTaskRow(task)));
    }

    if (archivedTasks.length > 0) {
      const toggleBtn = document.createElement("button");
      toggleBtn.className = "archived-toggle-link";
      toggleBtn.textContent = `${archivedTasks.length} archived task${archivedTasks.length !== 1 ? "s" : ""} — show`;
      const archivedWrap = document.createElement("div");
      archivedWrap.className = "archived-tasks-wrap";
      archivedWrap.style.display = "none";
      archivedTasks.forEach(task => archivedWrap.appendChild(renderTaskRow(task, { readonly: true })));

      toggleBtn.addEventListener("click", () => {
        const showing = archivedWrap.style.display !== "none";
        archivedWrap.style.display = showing ? "none" : "block";
        toggleBtn.textContent = `${archivedTasks.length} archived task${archivedTasks.length !== 1 ? "s" : ""} — ${showing ? "show" : "hide"}`;
      });

      block.appendChild(toggleBtn);
      block.appendChild(archivedWrap);
    }

    // Allow dropping a dragged task onto the block itself (moves to end of this sub-project)
    block.addEventListener("dragover", (e) => {
      e.preventDefault();
      block.classList.add("drag-over-block");
    });
    block.addEventListener("dragleave", () => block.classList.remove("drag-over-block"));
    block.addEventListener("drop", (e) => {
      e.preventDefault();
      block.classList.remove("drag-over-block");
      if (!draggedTaskId) return;
      moveTaskToEnd(draggedTaskId, sub.id);
      draggedTaskId = null;
    });

    container.appendChild(block);
  });
}

// Toggles a task's done state and stamps/clears completedAt so the
// "Completed (7 days)" dashboard stat and future features can rely on it.
function toggleTaskDone(task) {
  if (task.status === "done") {
    task.status = "todo";
    task.completedAt = null;
  } else {
    task.status = "done";
    task.completedAt = todayISO();
  }
  saveState();
}

function renderTaskRow(task, opts) {
  opts = opts || {};
  const row = document.createElement("div");
  row.className = "task-row note-" + task.priority + (task.status === "done" ? " done" : "");
  row.draggable = !opts.readonly;

  const overdue = task.dueDate && task.dueDate < todayISO() && task.status !== "done";
  const showArchiveBtn = !opts.readonly && task.status === "done" && !task.archived;

  row.innerHTML = `
    ${opts.readonly ? "" : `<span class="drag-handle" title="Drag to reorder">⋮⋮</span>`}
    <div class="task-checkbox ${task.status === "done" ? "checked" : ""}" data-id="${task.id}">${task.status === "done" ? "✓" : ""}</div>
    <div class="task-title">${escapeHtml(task.title)}</div>
    <div class="task-meta">
      <span class="priority-badge priority-${task.priority}">${task.priority}</span>
      ${task.dueDate ? `<span class="task-due ${overdue ? "overdue" : ""}">${formatDate(task.dueDate)}</span>` : ""}
      ${showArchiveBtn ? `<button class="icon-btn" data-action="archive-task" title="Archive task">📥</button>` : ""}
      ${opts.readonly ? `<button class="icon-btn" data-action="unarchive-task" title="Unarchive task">↩</button>` : ""}
    </div>
  `;

  row.querySelector(".task-checkbox").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleTaskDone(task);
    renderProjectView();
  });

  const archiveBtn = row.querySelector('[data-action="archive-task"]');
  if (archiveBtn) {
    archiveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      task.archived = true;
      saveState();
      renderProjectView();
    });
  }

  const unarchiveBtn = row.querySelector('[data-action="unarchive-task"]');
  if (unarchiveBtn) {
    unarchiveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      task.archived = false;
      saveState();
      renderProjectView();
    });
  }

  row.addEventListener("click", () => openTaskModal(task));

  if (opts.readonly) return row;

  // Drag and drop reordering / moving between sub-projects
  row.addEventListener("dragstart", (e) => {
    draggedTaskId = task.id;
    e.dataTransfer.effectAllowed = "move";
    row.classList.add("dragging");
  });
  row.addEventListener("dragend", () => row.classList.remove("dragging"));
  row.addEventListener("dragover", (e) => {
    e.preventDefault();
    row.classList.add("drag-over-row");
  });
  row.addEventListener("dragleave", () => row.classList.remove("drag-over-row"));
  row.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    row.classList.remove("drag-over-row");
    if (!draggedTaskId || draggedTaskId === task.id) return;
    moveTaskBefore(draggedTaskId, task.subprojectId, task.id);
    draggedTaskId = null;
  });

  return row;
}

function moveTaskBefore(taskId, targetSubprojectId, beforeTaskId) {
  const idx = state.tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return;
  const [moved] = state.tasks.splice(idx, 1);
  moved.subprojectId = targetSubprojectId;
  let insertIdx = state.tasks.findIndex(t => t.id === beforeTaskId);
  if (insertIdx === -1) insertIdx = state.tasks.length;
  state.tasks.splice(insertIdx, 0, moved);
  saveState();
  renderProjectView();
}

function moveTaskToEnd(taskId, targetSubprojectId) {
  const idx = state.tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return;
  const [moved] = state.tasks.splice(idx, 1);
  moved.subprojectId = targetSubprojectId;
  state.tasks.push(moved);
  saveState();
  renderProjectView();
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

/* ---------- Project modal (create / edit / delete) ---------- */

document.getElementById("btnAddProject").addEventListener("click", () => openProjectModal(null));
document.getElementById("btnEditProject").addEventListener("click", () => {
  const project = state.projects.find(p => p.id === currentProjectId);
  if (project) openProjectModal(project);
});
document.getElementById("btnArchiveProject").addEventListener("click", () => {
  if (currentProjectId) toggleArchiveProject(currentProjectId);
});
document.getElementById("btnDeleteProject").addEventListener("click", () => {
  if (currentProjectId) deleteProject(currentProjectId);
});

function openProjectModal(project) {
  editingProjectId = project ? project.id : null;
  document.getElementById("projectModalTitle").textContent = project ? "Edit Project" : "New Project";
  document.getElementById("saveProject").textContent = project ? "Save changes" : "Create";
  document.getElementById("inputProjectName").value = project ? project.name : "";
  document.getElementById("deleteProjectInModal").style.display = project ? "inline-block" : "none";
  renderColorPicker(project ? project.color : PROJECT_COLORS[0]);
  openModal("modalProject");
}

function renderColorPicker(selectedColor) {
  const wrap = document.getElementById("colorPicker");
  wrap.innerHTML = "";
  pendingColor = selectedColor || PROJECT_COLORS[0];
  PROJECT_COLORS.forEach((c) => {
    const sw = document.createElement("div");
    sw.className = "color-swatch" + (c === pendingColor ? " selected" : "");
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
  if (editingProjectId) {
    const p = state.projects.find(p => p.id === editingProjectId);
    if (p) { p.name = name; p.color = pendingColor; }
  } else {
    state.projects.push({ id: uid(), name, color: pendingColor, archived: false, createdAt: todayISO() });
  }
  saveState();
  closeModal("modalProject");
  renderProjectList();
  renderDashboard();
  if (editingProjectId && currentProjectId === editingProjectId) renderProjectView();
  editingProjectId = null;
});

document.getElementById("deleteProjectInModal").addEventListener("click", () => {
  if (editingProjectId) deleteProject(editingProjectId);
  closeModal("modalProject");
});

function toggleArchiveProject(projectId) {
  const p = state.projects.find(p => p.id === projectId);
  if (!p) return;
  p.archived = !p.archived;
  saveState();
  renderProjectList();
  renderDashboard();
  if (currentProjectId === projectId) {
    if (p.archived) {
      // Project is now hidden from the active list — return to dashboard.
      currentProjectId = null;
      document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.view === "dashboard"));
      showView("dashboard");
    } else {
      renderProjectView();
    }
  }
}

function deleteProject(projectId) {
  const p = state.projects.find(p => p.id === projectId);
  if (!p) return;
  if (!confirm(`Delete project "${p.name}" and all its sub-projects and tasks? This cannot be undone.`)) return;
  const subIds = state.subprojects.filter(s => s.projectId === projectId).map(s => s.id);
  state.tasks = state.tasks.filter(t => !subIds.includes(t.subprojectId));
  state.subprojects = state.subprojects.filter(s => s.projectId !== projectId);
  state.projects = state.projects.filter(p => p.id !== projectId);
  saveState();
  if (currentProjectId === projectId) {
    currentProjectId = null;
    document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.view === "dashboard"));
    showView("dashboard");
  }
  renderProjectList();
  renderDashboard();
}

/* ---------- Sub-project modal (create / edit / delete) ---------- */

document.getElementById("btnAddSubproject").addEventListener("click", () => openSubprojectModal(null));

function openSubprojectModal(sub) {
  editingSubprojectId = sub ? sub.id : null;
  document.getElementById("subprojectModalTitle").textContent = sub ? "Edit Sub-project" : "New Sub-project";
  document.getElementById("saveSubproject").textContent = sub ? "Save changes" : "Create";
  document.getElementById("inputSubprojectName").value = sub ? sub.name : "";
  document.getElementById("deleteSubprojectInModal").style.display = sub ? "inline-block" : "none";
  openModal("modalSubproject");
}

document.getElementById("saveSubproject").addEventListener("click", () => {
  const name = document.getElementById("inputSubprojectName").value.trim();
  if (!name || !currentProjectId) return;
  if (editingSubprojectId) {
    const s = state.subprojects.find(s => s.id === editingSubprojectId);
    if (s) s.name = name;
  } else {
    state.subprojects.push({ id: uid(), projectId: currentProjectId, name });
  }
  saveState();
  closeModal("modalSubproject");
  renderProjectView();
  editingSubprojectId = null;
});

document.getElementById("deleteSubprojectInModal").addEventListener("click", () => {
  if (editingSubprojectId) deleteSubproject(editingSubprojectId);
  closeModal("modalSubproject");
});

function deleteSubproject(subId) {
  const s = state.subprojects.find(s => s.id === subId);
  if (!s) return;
  if (!confirm(`Delete sub-project "${s.name}" and all its tasks? This cannot be undone.`)) return;
  state.tasks = state.tasks.filter(t => t.subprojectId !== subId);
  state.subprojects = state.subprojects.filter(s => s.id !== subId);
  saveState();
  renderProjectView();
}

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
    const wasDone = t.status === "done";
    Object.assign(t, data);
    if (data.status === "done" && !wasDone) t.completedAt = todayISO();
    if (data.status !== "done") t.completedAt = null;
  } else {
    state.tasks.push({
      id: uid(), ...data, archived: false,
      completedAt: data.status === "done" ? todayISO() : null,
      createdAt: todayISO()
    });
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

/* ---------- Global search ---------- */

document.getElementById("globalSearch").addEventListener("input", (e) => {
  const query = e.target.value.trim().toLowerCase();
  if (query.length === 0) {
    document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.view === preSearchView));
    showView(preSearchView);
    return;
  }
  renderSearchResults(query);
});

function renderSearchResults(query) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById("view-search").classList.add("active");
  document.getElementById("viewTitle").textContent = "Search";
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));

  const matches = state.tasks.filter(t =>
    !t.archived && (t.title.toLowerCase().includes(query) || (t.description || "").toLowerCase().includes(query))
  );

  document.getElementById("searchSub").textContent = `${matches.length} task${matches.length !== 1 ? "s" : ""} matching "${query}"`;

  const container = document.getElementById("searchResults");
  container.innerHTML = "";

  if (matches.length === 0) {
    container.innerHTML = '<div class="empty-state">No matching tasks.</div>';
    return;
  }

  matches.forEach(task => {
    const sub = state.subprojects.find(s => s.id === task.subprojectId);
    const project = sub ? state.projects.find(p => p.id === sub.projectId) : null;
    const overdue = task.dueDate && task.dueDate < todayISO() && task.status !== "done";
    const row = document.createElement("div");
    row.className = "search-result-row";
    row.innerHTML = `
      <div class="task-checkbox ${task.status === "done" ? "checked" : ""}">${task.status === "done" ? "✓" : ""}</div>
      <div style="flex:1;">
        <div class="task-title" style="${task.status === "done" ? "text-decoration:line-through;" : ""}">${escapeHtml(task.title)}</div>
        <div class="search-result-path">${project ? escapeHtml(project.name) : "Unknown project"} ${sub ? "› " + escapeHtml(sub.name) : ""}</div>
      </div>
      <div class="task-meta">
        <span class="priority-badge priority-${task.priority}">${task.priority}</span>
        ${task.dueDate ? `<span class="task-due ${overdue ? "overdue" : ""}">${formatDate(task.dueDate)}</span>` : ""}
      </div>
    `;
    row.addEventListener("click", () => {
      if (project) {
        document.getElementById("globalSearch").value = "";
        openProject(project.id);
        setTimeout(() => openTaskModal(task), 50);
      }
    });
    container.appendChild(row);
  });
}

/* ---------- Dashboard ---------- */

function renderDashboard() {
  const allTasks = state.tasks;
  const total = allTasks.length;
  const done = allTasks.filter(t => t.status === "done").length;
  const inProgress = allTasks.filter(t => t.status === "in-progress").length;
  const overdue = allTasks.filter(t => t.dueDate && t.dueDate < todayISO() && t.status !== "done").length;

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); // rolling 7-day window including today
  const sevenAgoISO = toLocalISO(sevenDaysAgo);
  const completed7d = allTasks.filter(t => t.status === "done" && t.completedAt && t.completedAt >= sevenAgoISO).length;

  document.getElementById("statTotal").textContent = total;
  document.getElementById("statDone").textContent = done;
  document.getElementById("statProgress").textContent = inProgress;
  document.getElementById("statOverdue").textContent = overdue;
  document.getElementById("statCompleted7d").textContent = completed7d;

  renderTodayTasks();
  renderProjectProgress();
  renderUpcoming();
}

function renderTodayTasks() {
  const today = todayISO();
  document.getElementById("todayDateLabel").textContent = formatDate(today);

  const list = document.getElementById("todayTasksList");
  list.innerHTML = "";

  const todays = state.tasks
    .filter(t => t.dueDate === today && !t.archived)
    .sort((a, b) => (a.status === "done") - (b.status === "done"));

  if (todays.length === 0) {
    list.innerHTML = '<div class="empty-note">Nothing due today.</div>';
    return;
  }

  todays.forEach(task => {
    const sub = state.subprojects.find(s => s.id === task.subprojectId);
    const project = sub ? state.projects.find(p => p.id === sub.projectId) : null;

    const row = document.createElement("div");
    row.className = "today-task-row note-" + task.priority + (task.status === "done" ? " done" : "");
    row.innerHTML = `
      <div class="task-checkbox ${task.status === "done" ? "checked" : ""}">${task.status === "done" ? "✓" : ""}</div>
      <div style="flex:1;">
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="today-task-path">${project ? escapeHtml(project.name) : "Unknown project"}${sub ? " › " + escapeHtml(sub.name) : ""}</div>
      </div>
      <span class="priority-badge priority-${task.priority}">${task.priority}</span>
    `;

    row.querySelector(".task-checkbox").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleTaskDone(task);
      renderDashboard();
    });

    row.addEventListener("click", () => {
      if (project) {
        openProject(project.id);
        setTimeout(() => openTaskModal(task), 50);
      }
    });

    list.appendChild(row);
  });
}

function renderProjectProgress() {
  const wrap = document.getElementById("projectProgressList");
  wrap.innerHTML = "";
  const activeProjects = state.projects.filter(p => !p.archived);
  if (activeProjects.length === 0) {
    wrap.innerHTML = '<div class="empty-note">Create a project to see progress here.</div>';
    return;
  }
  activeProjects.forEach(p => {
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

    const tasksToday = state.tasks.filter(t => t.dueDate === dateStr && !t.archived);
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
      state = migrateState(data);
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
