/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { ExtensionContext } from "vscode";

import { APILoader } from "../common/api";
import { BrowserWasiProcess } from "./process";
import RIL from "./ril";

RIL.install();

export async function activate(context: ExtensionContext) {
	return new APILoader(context, BrowserWasiProcess, async (source) => {
		return WebAssembly.compileStreaming(fetch(source.toString()));
	});
}

export function deactivate() {}
