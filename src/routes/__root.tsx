import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { CommandPalette } from "@/components/command-palette";

function RootLayout() {
  return (
    <div className="min-h-screen">
      <nav className="flex items-center gap-4 border-b px-6 py-3">
        <span className="font-semibold">DbUI</span>
        <Link
          to="/"
          className="text-sm text-muted-foreground hover:text-foreground [&.active]:text-foreground [&.active]:font-medium"
        >
          Home
        </Link>
        <Link
          to="/settings"
          className="text-sm text-muted-foreground hover:text-foreground [&.active]:text-foreground [&.active]:font-medium"
        >
          Settings
        </Link>
      </nav>
      <main className="p-6">
        <Outlet />
      </main>
      <CommandPalette />
    </div>
  );
}

function NotFound() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">404 - Not found</h1>
      <p className="text-muted-foreground">
        The page you are looking for does not exist.
      </p>
      <Link to="/" className="underline">
        Go home
      </Link>
    </div>
  );
}

export const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});
