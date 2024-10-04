/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ----------------------------------------------------------------------------------------- */
import { Worker } from "@vscode/wasm-kit/node";

import { WasiWorker } from "../../common/preview2/wasiWorker";
import RIL from "../ril";

RIL.install();

void Worker.main(WasiWorker);
