export interface TerminalLaunchProject {
  name: string;
  path: string;
}

export interface TerminalLaunchContext {
  projectName?: string;
  projectPath?: string;
}

export function getTerminalLaunchContext(
  projects: readonly TerminalLaunchProject[],
  projectName?: string,
): TerminalLaunchContext {
  const project = projectName
    ? projects.find((candidate) => candidate.name === projectName)
    : undefined;

  return {
    projectName: project?.name,
    projectPath: project?.path,
  };
}
