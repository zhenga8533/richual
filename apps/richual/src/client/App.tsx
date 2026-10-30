import { Landing } from "./pages/Landing";
import { LobbyPage } from "./pages/LobbyPage";
import { matchLobbyPath, usePathname } from "./router";

export function App() {
  const pathname = usePathname();
  const code = matchLobbyPath(pathname);

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex flex-1 flex-col items-center px-4 py-10">
        {code ? <LobbyPage key={code} code={code} /> : <Landing />}
      </main>
      <footer className="px-4 py-4 text-center text-xs text-parchment-dim/70">
        Unofficial fan project. Not affiliated with or endorsed by Valve.
      </footer>
    </div>
  );
}
