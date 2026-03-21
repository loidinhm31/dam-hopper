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

export const ProjectConfigSchema = z
  .object({
    name: z.string().min(1, "Project name must not be empty"),
    path: z.string().min(1, "Project path must not be empty"),
    type: ProjectTypeSchema,
    build_command: z.string().optional(),
    run_command: z.string().optional(),
    env_file: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .transform((p) => ({
    name: p.name,
    path: p.path,
    type: p.type,
    buildCommand: p.build_command,
    runCommand: p.run_command,
    envFile: p.env_file,
    tags: p.tags,
  }));

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const WorkspaceSchema = z.object({
  name: z.string().min(1, "Workspace name must not be empty"),
  root: z.string().default("."),
});

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
