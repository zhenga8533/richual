import { ThemeMenu } from "./components/ThemeMenu";
import { Toaster } from "./components/Toaster";
import { Landing } from "./pages/Landing";
import { LobbyPage } from "./pages/LobbyPage";
import { matchLobbyPath, navigate, usePathname } from "./router";

export function App() {
  const pathname = usePathname();
  const code = matchLobbyPath(pathname);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 pt-3">
        {code ? (
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate("/");
            }}
            className="font-display text-2xl text-accent-text"
          >
            Richual
          </a>
        ) : (
          <span />
        )}
        <ThemeMenu />
      </header>
      <main className="flex flex-1 flex-col items-center px-4 pt-2 pb-10">
        {code ? <LobbyPage key={code} code={code} /> : <Landing />}
      </main>
      <footer className="px-4 pb-4 text-center text-xs text-muted">
        Unofficial fan project. Not affiliated with or endorsed by Valve.
      </footer>
      <Toaster />
    </div>
  );
}
