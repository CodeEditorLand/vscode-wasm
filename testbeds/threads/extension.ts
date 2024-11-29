/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProcessOptions, Wasm } from "@vscode/wasm-wasi";
import { commands, ExtensionContext, Uri, window, workspace } from "vscode";

export async function activate(context: ExtensionContext) {
	const wasm: Wasm = await Wasm.load();

	commands.registerCommand("testbed-threads.run", async () => {
		const pty = wasm.createPseudoterminal();

		const terminal = window.createTerminal({
			name: "threads",
			pty,
			isTransient: true,
		});

		terminal.show(true);

		const options: ProcessOptions = {
			stdio: pty.stdio,
			mountPoints: [{ kind: "workspaceFolder" }],
		};

		const filename = Uri.joinPath(context.extensionUri, "out", "main.wasm");

		const bits = await workspace.fs.readFile(filename);
		// options.stdio.out = { kind: 'file', path: '/workspace/out.txt' };
		// options.stdio.out = { kind: 'pipe' };

		const process = await wasm.createProcess(
			"threads",
			WebAssembly.compile(bits),
			{ initial: 2, maximum: 160, shared: true },
			options,
		);
		// const decoder = new TextDecoder();
		// process.stdout!.onData(data => {
		// 	console.log('stdout', decoder.decode(data));
		// });

		process.run().catch((err) => {
			void window.showErrorMessage(err.message);
		});
	});
}

export function deactivate() {}
