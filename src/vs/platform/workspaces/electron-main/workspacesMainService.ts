/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { IWorkspacesMainService, IWorkspaceIdentifier, IStoredWorkspace, WORKSPACE_EXTENSION, IWorkspaceSavedEvent, UNTITLED_WORKSPACE_NAME, IResolvedWorkspace } from 'vs/platform/workspaces/common/workspaces';
import { TPromise } from 'vs/base/common/winjs.base';
import { isParent } from 'vs/platform/files/common/files';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { extname, join, dirname } from 'path';
import { mkdirp, writeFile } from 'vs/base/node/pfs';
import { readFileSync } from 'fs';
import { isLinux } from 'vs/base/common/platform';
import { copy, delSync, readdirSync } from 'vs/base/node/extfs';
import { nfcall } from 'vs/base/common/async';
import Event, { Emitter } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { isEqual } from 'vs/base/common/paths';
import { coalesce } from 'vs/base/common/arrays';
import { createHash } from 'crypto';

export class WorkspacesMainService implements IWorkspacesMainService {

	public _serviceBrand: any;

	protected workspacesHome: string;

	private _onWorkspaceSaved: Emitter<IWorkspaceSavedEvent>;
	private _onUntitledWorkspaceDeleted: Emitter<IWorkspaceIdentifier>;

	constructor(
		@IEnvironmentService private environmentService: IEnvironmentService,
		@ILogService private logService: ILogService
	) {
		this.workspacesHome = environmentService.workspacesHome;

		this._onWorkspaceSaved = new Emitter<IWorkspaceSavedEvent>();
		this._onUntitledWorkspaceDeleted = new Emitter<IWorkspaceIdentifier>();
	}

	public get onWorkspaceSaved(): Event<IWorkspaceSavedEvent> {
		return this._onWorkspaceSaved.event;
	}

	public get onUntitledWorkspaceDeleted(): Event<IWorkspaceIdentifier> {
		return this._onUntitledWorkspaceDeleted.event;
	}

	public resolveWorkspaceSync(path: string): IResolvedWorkspace {
		const isWorkspace = this.isInsideWorkspacesHome(path) || extname(path) === `.${WORKSPACE_EXTENSION}`;
		if (!isWorkspace) {
			return null; // does not look like a valid workspace config file
		}

		try {
			const workspace = JSON.parse(readFileSync(path, 'utf8')) as IStoredWorkspace;
			if (!Array.isArray(workspace.folders) || workspace.folders.length === 0) {
				this.logService.log(`${path} looks like an invalid workspace file.`);

				return null; // looks like an invalid workspace file
			}

			return {
				id: this.getWorkspaceId(path),
				configPath: path,
				folders: workspace.folders
			};
		} catch (error) {
			this.logService.log(`${path} cannot be parsed as JSON file (${error}).`);

			return null; // unable to read or parse as workspace file
		}
	}

	private isInsideWorkspacesHome(path: string): boolean {
		return isParent(path, this.environmentService.workspacesHome, !isLinux /* ignore case */);
	}

	public createWorkspace(folders: string[]): TPromise<IWorkspaceIdentifier> {
		if (!folders.length) {
			return TPromise.wrapError(new Error('Creating a workspace requires at least one folder.'));
		}

		const randomId = (Date.now() + Math.round(Math.random() * 1000)).toString();
		const untitledWorkspaceConfigFolder = join(this.workspacesHome, randomId);
		const untitledWorkspaceConfigPath = join(untitledWorkspaceConfigFolder, UNTITLED_WORKSPACE_NAME);

		return mkdirp(untitledWorkspaceConfigFolder).then(() => {
			const storedWorkspace: IStoredWorkspace = {
				folders: folders.map(folder => ({
					uri: folder
				}))
			};

			return writeFile(untitledWorkspaceConfigPath, JSON.stringify(storedWorkspace, null, '\t')).then(() => ({
				id: this.getWorkspaceId(untitledWorkspaceConfigPath),
				configPath: untitledWorkspaceConfigPath
			}));
		});
	}

	private getWorkspaceId(workspaceConfigPath: string): string {
		if (!isLinux) {
			workspaceConfigPath = workspaceConfigPath.toLowerCase(); // sanitize for platform file system
		}

		return createHash('md5').update(workspaceConfigPath).digest('hex');
	}

	public isUntitledWorkspace(workspace: IWorkspaceIdentifier): boolean {
		return this.isInsideWorkspacesHome(workspace.configPath);
	}

	public saveWorkspace(workspace: IWorkspaceIdentifier, target: string): TPromise<IWorkspaceIdentifier> {

		// Return early if target is same as source
		if (isEqual(workspace.configPath, target, !isLinux)) {
			return TPromise.as(workspace);
		}

		// Copy to new target
		return nfcall(copy, workspace.configPath, target).then(() => {
			const savedWorkspaceIdentifier = { id: this.getWorkspaceId(target), configPath: target };

			// Event
			this._onWorkspaceSaved.fire({ workspace: savedWorkspaceIdentifier, oldConfigPath: workspace.configPath });

			// Delete untitled workspace
			this.deleteUntitledWorkspaceSync(workspace);

			return savedWorkspaceIdentifier;
		});
	}

	public deleteUntitledWorkspaceSync(workspace: IWorkspaceIdentifier): void {
		if (!this.isUntitledWorkspace(workspace)) {
			return; // only supported for untitled workspaces
		}

		// Delete from disk
		this.doDeleteUntitledWorkspaceSync(workspace.configPath);

		// Event
		this._onUntitledWorkspaceDeleted.fire(workspace);
	}

	private doDeleteUntitledWorkspaceSync(configPath: string): void {
		try {
			delSync(dirname(configPath));
		} catch (error) {
			this.logService.log(`Unable to delete untitled workspace ${configPath} (${error}).`);
		}
	}

	public getUntitledWorkspacesSync(): IWorkspaceIdentifier[] {
		let untitledWorkspacePaths: string[] = [];
		try {
			untitledWorkspacePaths = readdirSync(this.workspacesHome).map(folder => join(this.workspacesHome, folder, UNTITLED_WORKSPACE_NAME));
		} catch (error) {
			this.logService.log(`Unable to read folders in ${this.workspacesHome} (${error}).`);
		}

		const untitledWorkspaces: IWorkspaceIdentifier[] = coalesce(untitledWorkspacePaths.map(untitledWorkspacePath => {
			const workspace = this.resolveWorkspaceSync(untitledWorkspacePath);
			if (!workspace) {
				this.doDeleteUntitledWorkspaceSync(untitledWorkspacePath);

				return null; // invalid workspace
			}

			return { id: workspace.id, configPath: untitledWorkspacePath };
		}));

		return untitledWorkspaces;
	}
}