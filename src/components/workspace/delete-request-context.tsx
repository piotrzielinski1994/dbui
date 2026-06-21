import { createContext, useContext, type ReactNode } from "react";
import type { TreeNode } from "@/components/workspace/mock-data";

type RequestDelete = (node: TreeNode) => void;

const DeleteRequestContext = createContext<RequestDelete | null>(null);

export function DeleteRequestProvider({
  value,
  children,
}: {
  value: RequestDelete;
  children: ReactNode;
}) {
  return (
    <DeleteRequestContext.Provider value={value}>
      {children}
    </DeleteRequestContext.Provider>
  );
}

export function useRequestDelete(): RequestDelete {
  const value = useContext(DeleteRequestContext);
  if (!value) {
    throw new Error("useRequestDelete must be used within a DeleteRequestProvider");
  }
  return value;
}
