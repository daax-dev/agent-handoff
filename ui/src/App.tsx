import { HashRouter, Routes, Route, NavLink } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LayoutDashboard, Settings2 } from "lucide-react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { KanbanBoard } from "@/pages/KanbanBoard";
import { ChangeSetDetail } from "@/pages/ChangeSetDetail";
import { Settings } from "@/pages/Settings";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

function Nav() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-colors ${
      isActive
        ? "text-foreground font-medium bg-accent"
        : "text-muted-foreground hover:text-foreground hover:bg-accent"
    }`;

  return (
    <nav className="h-12 border-b bg-card flex items-center px-4 gap-1 shrink-0">
      <span className="text-sm font-semibold mr-3 text-foreground tracking-tight">Local SDLC</span>
      <NavLink to="/" end className={linkClass}>
        <LayoutDashboard size={14} />
        Board
      </NavLink>
      <NavLink to="/settings" className={linkClass}>
        <Settings2 size={14} />
        Settings
      </NavLink>
      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
      </div>
    </nav>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <div className="min-h-screen bg-background text-foreground flex flex-col">
            <Nav />
            <main className="flex-1 overflow-auto">
              <Routes>
                <Route path="/" element={<KanbanBoard />} />
                <Route path="/change-sets/:id" element={<ChangeSetDetail />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </main>
          </div>
        </HashRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
