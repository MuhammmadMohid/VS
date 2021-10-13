/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export interface ISharedProcessWorkerConfiguration {

	/**
	 * The module to load as child process into the worker.
	 */
	moduleId: string;

	/**
	 * Configuration specific for how to reply with the `MessagePort`.
	 */
	reply: {
		windowId: number;
		channel: string;
		nonce: string;
	}
}

export const ISharedProcessWorkerService = createDecorator<ISharedProcessWorkerService>('sharedProcessWorkerService');

export const ipcSharedProcessWorkerChannelName = 'sharedProcessWorker';

export interface ISharedProcessWorkerService {

	readonly _serviceBrand: undefined;

	/**
	 * Creates a new worker with node.js enabled loading the provided
	 * `moduleId` as a child process and wiring in the communication
	 * from the child process through a `MessagePort`.
	 *
	 * Caller needs to listen to `reply.channel` for a response.
	 */
	createWorker(configuration: ISharedProcessWorkerConfiguration): Promise<void>;
}
