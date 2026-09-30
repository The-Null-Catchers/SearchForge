"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity, BarChart3, Braces, Database, FileSearch, Gauge, KeyRound, ListTree,
  Moon, Search, Settings, SlidersHorizontal, Sparkles, Sun, TerminalSquare
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ProjectProvider, useProject } from "./project-context";

const navigation = [
  ["/dashboard", "Overview", Gauge],
  ["/dashboard/indexes", "Indexes", Database],
  ["/dashboard/sources", "Sources", ListTree],
  ["/dashboard/playground", "Search Playground", Search],
  ["/dashboard/analytics", "Analytics", BarChart3],
  ["/dashboard/ranking", "Ranking", SlidersHorizontal],
  ["/dashboard/synonyms", "Synonyms", Braces],
  ["/dashboard/api-keys", "API Keys", KeyRound],
  ["/dashboard/logs", "Logs", TerminalSquare],
  ["/dashboard/settings", "Settings", Settings]
] as const;

function InnerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { projects, projectId, setProjectId } = useProject();
  const [commandOpen, setCommandOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const saved = (localStorage.getItem("sf_theme") as "dark" | "light" | null) ?? "dark";
    setTheme(saved);
    document.documentElement.dataset.theme = saved;
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((value) => !value);
      }
      if (event.key === "Escape") setCommandOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("sf_theme", next);
    document.documentElement.dataset.theme = next;
  };

  const filtered = useMemo(() => navigation.filter(([, label]) => label.toLowerCase().includes(filter.toLowerCase())), [filter]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Sparkles size={17} /></div>SearchForge</div>
        <select className="project-select" value={projectId ?? ""} onChange={(event) => setProjectId(event.target.value)}>
          {projects.length === 0 && <option value="">No project selected</option>}
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <nav className="nav">
          {navigation.map(([href,label,Icon]) => (
            <Link key={href} href={href} className={pathname === href ? "active" : ""}><Icon size={16}/><span>{label}</span></Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="btn" onClick={() => setCommandOpen(true)}><Search size={14}/> Command palette <span className="kbd">⌘K</span></button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="muted mono" style={{fontSize:12}}>{projects.find((p) => p.id === projectId)?.slug ?? "workspace"}</div>
          <div className="topbar-actions">
            <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme">{theme === "dark" ? <Sun size={16}/> : <Moon size={16}/>}</button>
            <div className="icon-btn" title="System status"><Activity size={16}/></div>
          </div>
        </header>
        {children}
      </main>
      {commandOpen && (
        <div className="command-backdrop" onMouseDown={() => setCommandOpen(false)}>
          <div className="command" onMouseDown={(event) => event.stopPropagation()}>
            <input autoFocus value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Navigate SearchForge…" />
            <div className="command-list">
              {filtered.map(([href,label,Icon]) => (
                <button key={href} className="command-item" style={{width:"100%",border:0,background:"transparent"}} onClick={() => { router.push(href); setCommandOpen(false); setFilter(""); }}>
                  <span style={{display:"flex",gap:10,alignItems:"center"}}><Icon size={16}/>{label}</span><span className="muted">Open</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return <ProjectProvider><InnerShell>{children}</InnerShell></ProjectProvider>;
}
