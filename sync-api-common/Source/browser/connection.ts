/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import {
	BaseClientConnection,
	BaseServiceConnection,
	Message,
	Params,
	RequestType,
} from "../common/connection";
import RAL from "../common/ral";

export class ClientConnection<
	Requests extends RequestType | undefined = undefined,
	ReadyParams extends Params | undefined = undefined,
> extends BaseClientConnection<Requests, ReadyParams> {
	private readonly port: MessagePort | Worker | DedicatedWorkerGlobalScope;

	constructor(port: MessagePort | Worker | DedicatedWorkerGlobalScope) {
		super();

		this.port = port;

		this.port.onmessage = (event: MessageEvent<Message>) => {
			this.handleMessage(event.data);
		};
	}

	protected postMessage(sharedArrayBuffer: SharedArrayBuffer) {
		this.port.postMessage(sharedArrayBuffer);
	}
}

export class ServiceConnection<
	RequestHandlers extends RequestType | undefined = undefined,
	ReadyParams extends Params | undefined = undefined,
> extends BaseServiceConnection<RequestHandlers, ReadyParams> {
	private readonly port: MessagePort | Worker | DedicatedWorkerGlobalScope;

	constructor(port: MessagePort | Worker | DedicatedWorkerGlobalScope) {
		super();

		this.port = port;

		this.port.onmessage = async (
			event: MessageEvent<SharedArrayBuffer>,
		) => {
			try {
				await this.handleMessage(event.data);
			} catch (error) {
				RAL().console.error(error);
			}
		};
	}

	protected postMessage(message: Message): void {
		this.port.postMessage(message);
	}
}
