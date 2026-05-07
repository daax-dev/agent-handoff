import { HashRouter, Routes, Route, NavLink } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KanbanBoard } from "@/pages/KanbanBoard";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Nav() {
  return (
    <nav className="border-b bg-background px-4 py-2 flex items-center gap-4">
      <span className="font-semibold text-sm">Local SDLC</span>
      <NavLink
        to="/"
        className={({ isActive }) =>
          `text-sm ${isActive ? "text-primary font-medium" : "text-muted-foreground hover:text-foreground"}`
        }
      >
        Board
      </NavLink>
    </nav>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <div className="min-h-screen bg-background text-foreground flex flex-col">
          <Nav />
          <main className="flex-1 overflow-auto">
            <Routes>
              <Route path="/" element={<KanbanBoard />} />
            </Routes>
          </main>
        </div>
      </HashRouter>
    </QueryClientProvider>
  );
}

export default App;
