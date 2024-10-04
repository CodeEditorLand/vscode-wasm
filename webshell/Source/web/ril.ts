/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { Uri } from "vscode";

import RAL from "../common/ral";
import * as path from "./path";

const _ril: RAL = Object.freeze<RAL>({
	path: path.posix,
	webAssembly: Object.freeze({
		async compile(Uri: Uri): Promise<WebAssembly.Module> {
			return WebAssembly.compileStreaming(fetch(Uri.toString()));
		},
	}),
});

function RIL(): RAL {
	return _ril;
}

namespace RIL {
	export function install(): void {
		RAL.install(_ril);
	}
}

if (!RAL.isInstalled()) {
	RAL.install(_ril);
}
export default RIL;
