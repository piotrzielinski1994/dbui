import { toast } from "sonner";
import type { UpdateInfo } from "@/lib/updater/update-controller";

async function runUpdate(update: UpdateInfo, id: string | number) {
  toast(`Downloading… 0%`, { id, duration: Infinity });
  await update.downloadAndInstall((pct) =>
    toast(`Downloading… ${pct}%`, { id, duration: Infinity }),
  );
  toast(`Installing…`, { id, duration: Infinity });
  await update.relaunch();
}

export function showUpdateToast(update: UpdateInfo): string | number {
  const id = `update-${update.version}`;
  toast(`Update available: ${update.version}`, {
    id,
    duration: Infinity,
    closeButton: true,
    action: {
      label: "Update now",
      onClick: () => {
        runUpdate(update, id).catch(() => {
          toast.error(`Update failed`, { id, duration: Infinity });
        });
      },
    },
  });
  return id;
}
