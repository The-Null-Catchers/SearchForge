"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

export type Project = {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  role: string;
};

type ContextValue = {
  projects: Project[];
  projectId: string | null;
  setProjectId: (id: string) => void;
  refresh: () => Promise<void>;
  loading: boolean;
};

const ProjectContext = createContext<ContextValue | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const result = await api<{ projects: Project[] }>("/v1/me/projects");
      setProjects(result.projects);
      const saved = localStorage.getItem("sf_project_id");
      const next = result.projects.find((project) => project.id === saved)?.id ?? result.projects[0]?.id ?? null;
      setProjectIdState(next);
      if (next) localStorage.setItem("sf_project_id", next);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const setProjectId = (id: string) => {
    setProjectIdState(id);
    localStorage.setItem("sf_project_id", id);
  };

  const value = useMemo(() => ({ projects, projectId, setProjectId, refresh, loading }), [projects, projectId, loading]);
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const value = useContext(ProjectContext);
  if (!value) throw new Error("useProject must be used within ProjectProvider");
  return value;
}
