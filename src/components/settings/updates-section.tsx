import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useUpdater } from "@/lib/updater/updater-context";
import { showUpdateToast } from "@/lib/updater/show-update-toast";

export function UpdatesSection() {
  const { controller, getVersion } = useUpdater();
  const [version, setVersion] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    let isActive = true;
    getVersion().then((v) => {
      if (isActive) {
        setVersion(v);
      }
    });
    return () => {
      isActive = false;
    };
  }, [getVersion]);

  const check = () => {
    if (isChecking) {
      return;
    }
    setIsChecking(true);
    controller
      .check()
      .then((update) => {
        if (update === null) {
          toast("You're on the latest version");
          return;
        }
        showUpdateToast(update);
      })
      .catch(() => toast.error("Update check failed"))
      .finally(() => setIsChecking(false));
  };

  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-lg font-medium">Updates</h2>
      <p className="text-sm text-muted-foreground">
        Current version: {version ?? "…"}
      </p>
      <button
        type="button"
        disabled={isChecking}
        onClick={check}
        className="mt-2 h-8 w-fit border border-border bg-transparent px-3 text-sm text-foreground outline-none hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
      >
        {isChecking ? "Checking…" : "Check for updates"}
      </button>
    </section>
  );
}
