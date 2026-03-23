import { z } from "zod";

export const ProjectTypeSchema = z.enum([
  "maven",
  "gradle",
  "npm",
  "pnpm",
  "cargo",
  "custom",
]);

export type ProjectType = z.infer<typeof ProjectTypeSchema>;

export const ServiceConfigSchema = z
  .object({
    name: z.string().min(1, "Service name must not be empty"),
    build_command: z.string().optional(),
    run_command: z.string().optional(),
  })
  .transform((s) => ({
    name: s.name,
    buildCommand: s.build_command,
    runCommand: s.run_command,
  }));

export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;

export const ProjectConfigSchema = z
  .object({
    name: z.string().min(1, "Project name must not be empty"),
    path: z.string().min(1, "Project path must not be empty"),
    type: ProjectTypeSchema,
    services: z.array(ServiceConfigSchema).optional(),
    commands: z.record(z.string()).optional(),
    env_file: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .refine(
    (p) => {
      if (!p.services) return true;
      const names = p.services.map((s) => s.name);
      return names.length === new Set(names).size;
    },
    {
      message: "Service names must be unique within a project",
      path: ["services"],
    },
  )
  .transform((p) => ({
    name: p.name,
    path: p.path,
    type: p.type,
    services: p.services,
    commands: p.commands,
    envFile: p.env_file,
    tags: p.tags,
  }));

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const WorkspaceSchema = z.object({
  name: z.string().min(1, "Workspace name must not be empty"),
  root: z.string().default("."),
});

// Camelcase schemas for API endpoints (HTTP JSON in/out — no transforms needed)
export const ApiServiceSchema = z.object({
  name: z.string().min(1, "Service name must not be empty"),
  buildCommand: z.string().optional(),
  runCommand: z.string().optional(),
});

export const ApiProjectSchema = z
  .object({
    name: z.string().min(1, "Project name must not be empty"),
    path: z.string().min(1, "Project path must not be empty"),
    type: ProjectTypeSchema,
    services: z.array(ApiServiceSchema).optional(),
    commands: z.record(z.string()).optional(),
    envFile: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .refine(
    (p) => {
      if (!p.services) return true;
      const names = p.services.map((s) => s.name);
      return names.length === new Set(names).size;
    },
    {
      message: "Service names must be unique within a project",
      path: ["services"],
    },
  );

export const DevHubApiConfigSchema = z
  .object({
    workspace: WorkspaceSchema,
    projects: z.array(ApiProjectSchema).default([]),
  })
  .refine(
    (cfg) => {
      const names = cfg.projects.map((p: { name: string }) => p.name);
      return names.length === new Set(names).size;
    },
    { message: "Project names must be unique", path: ["projects"] },
  );

export type WorkspaceInfo = z.infer<typeof WorkspaceSchema>;

export const DevHubConfigSchema = z
  .object({
    workspace: WorkspaceSchema,
    projects: z.array(ProjectConfigSchema).default([]),
  })
  .refine(
    (cfg) => {
      const names = cfg.projects.map((p) => p.name);
      return names.length === new Set(names).size;
    },
    {
      message: "Project names must be unique",
      path: ["projects"],
    },
  );

export type DevHubConfig = z.infer<typeof DevHubConfigSchema>;
