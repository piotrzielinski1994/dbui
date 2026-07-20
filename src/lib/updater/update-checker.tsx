import { useEffect, useRef } from "react";
import type { UpdateController } from "@/lib/updater/update-controller";
import { showUpdateToast } from "@/lib/updater/show-update-toast";

export function UpdateChecker({
  controller,
}: {
  controller: UpdateController;
}) {
  const hasChecked = useRef(false);

  useEffect(() => {
    if (hasChecked.current) {
      return;
    }
    hasChecked.current = true;
    controller
      .check()
      .then((update) => {
        if (update !== null) {
          showUpdateToast(update);
        }
      })
      .catch(() => {});
  }, [controller]);

  return null;
}
