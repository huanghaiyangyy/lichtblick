// SPDX-FileCopyrightText: Copyright (C) 2023-2024 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useMemo, createContext, useContext } from "react";
import { DeepPartial } from "ts-essentials";

import { useCrash } from "@lichtblick/hooks";
import { CaptureErrorBoundary } from "@lichtblick/suite-base/components/CaptureErrorBoundary";
import {
  ForwardAnalyticsContextProvider,
  ForwardedAnalytics,
  useForwardAnalytics,
} from "@lichtblick/suite-base/components/ForwardAnalyticsContextProvider";
import Panel from "@lichtblick/suite-base/components/Panel";
import {
  BuiltinPanelExtensionContext,
  PanelExtensionAdapter,
} from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import { INJECTED_FEATURE_KEYS, useAppContext } from "@lichtblick/suite-base/context/AppContext";
import { TestOptions } from "@lichtblick/suite-base/panels/ThreeDeeRender/IRenderer";
import { createSyncRoot } from "@lichtblick/suite-base/panels/createSyncRoot";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";

import { SceneExtensionConfig } from "./SceneExtensionConfig";
import { ThreeDeeRender } from "./ThreeDeeRender";
import { InterfaceMode } from "./types";
import CurrentLayoutContext from "@lichtblick/suite-base/context/CurrentLayoutContext";
import useGlobalVariables, { GlobalVariables } from "@lichtblick/suite-base/hooks/useGlobalVariables";
import * as PanelAPI from "@lichtblick/suite-base/PanelAPI";
import { RenderContext } from "./utils/RenderContext";

type RenderContextType = {
  globalVariables: GlobalVariables;
  setGlobalVariables: (arg: GlobalVariables) => void;
  datatypes: ReadonlyMap<string, unknown>;
  topics: readonly{name: string; schemaName: string | undefined; aliasedFromName?: string | undefined}[];
};

export const RenderContext_ = createContext<RenderContextType | undefined>(undefined);

export function useRenderContext() {
  const context = useContext(RenderContext_);
  if (context === undefined) {
    throw new Error("useRenderContext must be used within a RenderContextProvider");
  }
  return context;
}

function CheckContext(): React.JSX.Element | null {
  // Check if CurrentLayoutContext is available
  const currentLayout = useContext(CurrentLayoutContext);

  // If context isn't available, render nothing
  if (!currentLayout) {
    console.warn("[ThreeDee] CurrentLayoutContext is not available. MessagePathInput cannot be used.");
    return null;
  }

  console.debug("[ThreeDee index] CurrentLayoutContext is available:", currentLayout);

  // Context is available, so we can use MessagePathInput
  return null;
}

type InitPanelArgs = {
  crash: ReturnType<typeof useCrash>;
  forwardedAnalytics: ForwardedAnalytics;
  interfaceMode: InterfaceMode;
  testOptions: TestOptions;
  customSceneExtensions?: DeepPartial<SceneExtensionConfig>;
  globalVariables: GlobalVariables;
  setGlobalVariables: (arg: GlobalVariables) => void;
  datatypes: ReadonlyMap<string, unknown>;
  topics: readonly{name: string; schemaName: string | undefined; aliasedFromName?: string | undefined}[];
};

function initPanel(args: InitPanelArgs, context: BuiltinPanelExtensionContext) {
  const {
    crash,
    forwardedAnalytics,
    interfaceMode,
    testOptions,
    customSceneExtensions,
    globalVariables,
    setGlobalVariables,
    datatypes,
    topics,
  } = args;
  return createSyncRoot(
    <RenderContext.Provider
      value={{
        globalVariables,
        setGlobalVariables: setGlobalVariables,
        datatypes,
        topics_: topics,
      }}
    >
      <CaptureErrorBoundary onError={crash}>
        <ForwardAnalyticsContextProvider forwardedAnalytics={forwardedAnalytics}>
          <ThreeDeeRender
            context={context}
            interfaceMode={interfaceMode}
            testOptions={testOptions}
            customSceneExtensions={customSceneExtensions}
          />
        </ForwardAnalyticsContextProvider>
      </CaptureErrorBoundary>
    </RenderContext.Provider>,
    context.panelElement,
  );
}

type Props = {
  config: Record<string, unknown>;
  saveConfig: SaveConfig<Record<string, unknown>>;
  onDownloadImage?: (blob: Blob, fileName: string) => void;
  debugPicking?: boolean;
};

function ThreeDeeRenderAdapter(interfaceMode: InterfaceMode, props: Props) {
  const crash = useCrash();

  const forwardedAnalytics = useForwardAnalytics();
  const { injectedFeatures } = useAppContext();
  const customSceneExtensions = useMemo(() => {
    if (injectedFeatures == undefined) {
      return undefined;
    }
    const injectedSceneExtensions =
      injectedFeatures.availableFeatures[INJECTED_FEATURE_KEYS.customSceneExtensions]
        ?.customSceneExtensions;
    return injectedSceneExtensions;
  }, [injectedFeatures]);

  const { globalVariables, setGlobalVariables } = useGlobalVariables();
  const { datatypes, topics } = PanelAPI.useDataSourceInfo();

  const boundInitPanel = useMemo(
    () =>
      initPanel.bind(undefined, {
        crash,
        forwardedAnalytics,
        interfaceMode,
        testOptions: { onDownloadImage: props.onDownloadImage, debugPicking: props.debugPicking },
        customSceneExtensions,
        globalVariables,
        setGlobalVariables,
        datatypes,
        topics,
      }),
    [
      crash,
      forwardedAnalytics,
      interfaceMode,
      props.onDownloadImage,
      props.debugPicking,
      customSceneExtensions,
      globalVariables,
      setGlobalVariables,
      datatypes,
      topics,
    ],
  );

  return (
    <>
      <CheckContext />
      <PanelExtensionAdapter
        config={props.config}
        highestSupportedConfigVersion={1}
        saveConfig={props.saveConfig}
        initPanel={boundInitPanel}
      />
    </>
  );
}

/**
 * The Image panel is a special case of the 3D panel with `interfaceMode` set to `"image"`.
 */
export const ImagePanel = Panel<Record<string, unknown>, Props>(
  Object.assign(ThreeDeeRenderAdapter.bind(undefined, "image"), {
    panelType: "Image",
    defaultConfig: {},
  }),
);

export default Panel(
  Object.assign(ThreeDeeRenderAdapter.bind(undefined, "3d"), {
    panelType: "3D",
    defaultConfig: {},
  }),
);
