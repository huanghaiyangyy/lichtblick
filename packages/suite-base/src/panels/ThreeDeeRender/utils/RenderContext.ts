import { createContext, useContext } from "react";
import { GlobalVariables } from "@lichtblick/suite-base/hooks/useGlobalVariables";

type RenderContextType = {
  globalVariables?: GlobalVariables;
  setGlobalVariables: (arg: GlobalVariables) => void;
  datatypes: ReadonlyMap<string, unknown>;
  topics_: readonly{name: string; schemaName: string | undefined; aliasedFromName?: string | undefined}[];
};

export const RenderContext = createContext<RenderContextType | undefined>(undefined);

export function useRenderContext() {
  const context = useContext(RenderContext);
  if (context === undefined) {
    throw new Error("useRenderContext must be used within a RenderContextProvider");
  }
  return context;
}
