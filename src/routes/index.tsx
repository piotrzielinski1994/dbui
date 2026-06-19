import { createRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { greet } from "@/lib/tauri";
import { Button } from "@/components/ui/button";
import { DemoTable } from "@/components/demo-table";
import { DemoForm } from "@/components/demo-form";
import { rootRoute } from "@/routes/__root";

function Greeting() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["greet", "World"],
    queryFn: () => greet("World"),
  });

  if (isPending) {
    return <p data-testid="greeting-loading">Loading...</p>;
  }

  if (isError) {
    return (
      <p role="alert" data-testid="greeting-error">
        Failed to greet: {error instanceof Error ? error.message : "unknown"}
      </p>
    );
  }

  return <p data-testid="greeting">{data}</p>;
}

function HomePage() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Home</h1>
        <Greeting />
        <div>
          <Button>Primary action</Button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Database objects</h2>
        <DemoTable />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">New connection</h2>
        <DemoForm />
      </section>
    </div>
  );
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});
