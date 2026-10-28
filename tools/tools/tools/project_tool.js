const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const DB_FILE = path.resolve(
  process.env.PELEX_PROJECTS_FILE ||
  "./data/public-agent-projects.json"
);

async function readProjects() {
  try {
    const content = await fs.readFile(
      DB_FILE,
      "utf8"
    );

    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function saveProjects(projects) {
  await fs.mkdir(
    path.dirname(DB_FILE),
    { recursive: true }
  );

  await fs.writeFile(
    DB_FILE,
    JSON.stringify(projects, null, 2),
    "utf8"
  );
}

module.exports = {
  name: "project_tool",

  description:
    "Manage project task lists, priorities, deadlines, and progress.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "list",
          "add",
          "update",
          "summary"
        ]
      },

      project: {
        type: "string",
        description: "Project name"
      },

      task: {
        type: "string",
        description: "Task description when adding a task"
      },

      taskId: {
        type: "string",
        description: "ID of the task to update"
      },

      status: {
        type: "string",
        enum: [
          "todo",
          "in_progress",
          "done",
          "blocked"
        ]
      },

      priority: {
        type: "string",
        enum: [
          "low",
          "medium",
          "high"
        ]
      },

      deadline: {
        type: "string",
        description: "Optional deadline in YYYY-MM-DD format"
      }
    },

    required: [
      "action",
      "project"
    ]
  },

  label: a => `Project ${a.action}`,

  async run(a) {
    const projects = await readProjects();

    let project = projects.find(
      item =>
        item.name.toLowerCase() ===
        a.project.toLowerCase()
    );

    if (a.action === "add") {
      if (
        typeof a.task !== "string" ||
        !a.task.trim()
      ) {
        throw new Error(
          "Provide a task description."
        );
      }

      if (!project) {
        project = {
          name: a.project,
          tasks: []
        };

        projects.push(project);
      }

      const task = {
        id: crypto.randomUUID(),
        title: a.task.trim(),
        status: "todo",
        priority: a.priority || "medium",
        deadline: a.deadline || null,
        createdAt: new Date().toISOString()
      };

      project.tasks.push(task);

      await saveProjects(projects);

      return {
        ok: true,
        project: project.name,
        task
      };
    }

    if (!project) {
      return {
        project: a.project,
        tasks: [],
        message: "Project not found."
      };
    }

    if (a.action === "update") {
      const task = project.tasks.find(
        item => item.id === a.taskId
      );

      if (!task) {
        throw new Error(
          "The specified task ID was not found."
        );
      }

      if (a.status) {
        task.status = a.status;
      }

      if (a.priority) {
        task.priority = a.priority;
      }

      if (a.deadline !== undefined) {
        task.deadline = a.deadline;
      }

      await saveProjects(projects);

      return {
        ok: true,
        project: project.name,
        task
      };
    }

    if (a.action === "summary") {
      const total = project.tasks.length;

      const completed = project.tasks.filter(
        task => task.status === "done"
      ).length;

      const byStatus = {
        todo: 0,
        in_progress: 0,
        done: 0,
        blocked: 0
      };

      for (const task of project.tasks) {
        byStatus[task.status] =
          (byStatus[task.status] || 0) + 1;
      }

      return {
        project: project.name,
        total,
        completed,
        completionPercent: total
          ? Math.round(
              (completed / total) * 100
            )
          : 0,
        byStatus
      };
    }

    return project;
  }
};