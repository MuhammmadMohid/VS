/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import {TPromise} from 'vs/base/common/winjs.base';
import URI from 'vs/base/common/uri';
import errors = require('vs/base/common/errors');
import Event, {Emitter} from 'vs/base/common/event';
import {FileEditorInput} from 'vs/workbench/parts/files/common/editors/fileEditorInput';
import {CACHE, TextFileEditorModel} from 'vs/workbench/parts/files/common/editors/textFileEditorModel';
import {IResult, ITextFileOperationResult, ITextFileService, IRawTextContent, IAutoSaveConfiguration, AutoSaveMode} from 'vs/workbench/parts/files/common/files';
import {ConfirmResult} from 'vs/workbench/common/editor';
import {ILifecycleService} from 'vs/platform/lifecycle/common/lifecycle';
import {IWorkspaceContextService} from 'vs/platform/workspace/common/workspace';
import {IFileService, IResolveContentOptions, IFilesConfiguration, IFileOperationResult, FileOperationResult, AutoSaveConfiguration} from 'vs/platform/files/common/files';
import {IInstantiationService} from 'vs/platform/instantiation/common/instantiation';
import {IEventService} from 'vs/platform/event/common/event';
import {IConfigurationService} from 'vs/platform/configuration/common/configuration';
import {ITelemetryService} from 'vs/platform/telemetry/common/telemetry';
import {IDisposable, dispose} from 'vs/base/common/lifecycle';
import {IWorkbenchEditorService} from 'vs/workbench/services/editor/common/editorService';
import {IModelService} from 'vs/editor/common/services/modelService';
import {IEditorGroupService} from 'vs/workbench/services/group/common/groupService';

/**
 * The workbench file service implementation implements the raw file service spec and adds additional methods on top.
 *
 * It also adds diagnostics and logging around file system operations.
 */
export abstract class TextFileService implements ITextFileService {

	public _serviceBrand: any;

	protected listenerToUnbind: IDisposable[];

	private _onAutoSaveConfigurationChange: Emitter<IAutoSaveConfiguration>;

	private configuredAutoSaveDelay: number;
	protected configuredAutoSaveOnFocusChange: boolean;
	protected configuredAutoSaveOnWindowChange: boolean;

	constructor(
		@ILifecycleService protected lifecycleService: ILifecycleService,
		@IWorkspaceContextService protected contextService: IWorkspaceContextService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IConfigurationService private configurationService: IConfigurationService,
		@ITelemetryService private telemetryService: ITelemetryService,
		@IEditorGroupService private editorGroupService: IEditorGroupService,
		@IWorkbenchEditorService protected editorService: IWorkbenchEditorService,
		@IEventService private eventService: IEventService,
		@IFileService protected fileService: IFileService,
		@IModelService protected modelService: IModelService
	) {
		this.listenerToUnbind = [];
		this._onAutoSaveConfigurationChange = new Emitter<IAutoSaveConfiguration>();

		const configuration = this.configurationService.getConfiguration<IFilesConfiguration>();
		this.onConfigurationChange(configuration);

		this.telemetryService.publicLog('autoSave', this.getAutoSaveConfiguration());

		this.registerListeners();
	}

	public abstract resolveTextContent(resource: URI, options?: IResolveContentOptions): TPromise<IRawTextContent>;

	public get onAutoSaveConfigurationChange(): Event<IAutoSaveConfiguration> {
		return this._onAutoSaveConfigurationChange.event;
	}

	protected registerListeners(): void {

		// Configuration changes
		this.listenerToUnbind.push(this.configurationService.onDidUpdateConfiguration(e => this.onConfigurationChange(e.config)));

		// Application & Editor focus change
		window.addEventListener('blur', () => this.onWindowFocusLost());
		window.addEventListener('blur', () => this.onEditorFocusChanged(), true);
		this.listenerToUnbind.push(this.editorGroupService.onEditorsChanged(() => this.onEditorFocusChanged()));
	}

	private onWindowFocusLost(): void {
		if (this.configuredAutoSaveOnWindowChange && this.isDirty()) {
			this.saveAll().done(null, errors.onUnexpectedError);
		}
	}

	private onEditorFocusChanged(): void {
		if (this.configuredAutoSaveOnFocusChange && this.isDirty()) {
			this.saveAll().done(null, errors.onUnexpectedError);
		}
	}

	private onConfigurationChange(configuration: IFilesConfiguration): void {
		const wasAutoSaveEnabled = (this.getAutoSaveMode() !== AutoSaveMode.OFF);

		const autoSaveMode = (configuration && configuration.files && configuration.files.autoSave) || AutoSaveConfiguration.OFF;
		switch (autoSaveMode) {
			case AutoSaveConfiguration.AFTER_DELAY:
				this.configuredAutoSaveDelay = configuration && configuration.files && configuration.files.autoSaveDelay;
				this.configuredAutoSaveOnFocusChange = false;
				this.configuredAutoSaveOnWindowChange = false;
				break;

			case AutoSaveConfiguration.ON_FOCUS_CHANGE:
				this.configuredAutoSaveDelay = void 0;
				this.configuredAutoSaveOnFocusChange = true;
				this.configuredAutoSaveOnWindowChange = false;
				break;

			case AutoSaveConfiguration.ON_WINDOW_CHANGE:
				this.configuredAutoSaveDelay = void 0;
				this.configuredAutoSaveOnFocusChange = false;
				this.configuredAutoSaveOnWindowChange = true;
				break;

			default:
				this.configuredAutoSaveDelay = void 0;
				this.configuredAutoSaveOnFocusChange = false;
				this.configuredAutoSaveOnWindowChange = false;
				break;
		}

		// Emit as event
		this._onAutoSaveConfigurationChange.fire(this.getAutoSaveConfiguration());

		// save all dirty when enabling auto save
		if (!wasAutoSaveEnabled && this.getAutoSaveMode() !== AutoSaveMode.OFF) {
			this.saveAll().done(null, errors.onUnexpectedError);
		}
	}

	public getDirty(resources?: URI[]): URI[] {
		return this.getDirtyFileModels(resources).map((m) => m.getResource());
	}

	public isDirty(resource?: URI): boolean {
		return CACHE
			.getAll(resource)
			.some((model) => model.isDirty());
	}

	public save(resource: URI): TPromise<boolean> {
		return this.saveAll([resource]).then((result) => result.results.length === 1 && result.results[0].success);
	}

	public saveAll(arg1?: any /* URI[] */): TPromise<ITextFileOperationResult> {
		let dirtyFileModels = this.getDirtyFileModels(Array.isArray(arg1) ? arg1 : void 0 /* Save All */);

		let mapResourceToResult: { [resource: string]: IResult } = Object.create(null);
		dirtyFileModels.forEach((m) => {
			mapResourceToResult[m.getResource().toString()] = {
				source: m.getResource()
			};
		});

		return TPromise.join(dirtyFileModels.map((model) => {
			return model.save().then(() => {
				if (!model.isDirty()) {
					mapResourceToResult[model.getResource().toString()].success = true;
				}
			});
		})).then((r) => {
			return {
				results: Object.keys(mapResourceToResult).map((k) => mapResourceToResult[k])
			};
		});
	}

	private getFileModels(resources?: URI[]): TextFileEditorModel[];
	private getFileModels(resource?: URI): TextFileEditorModel[];
	private getFileModels(arg1?: any): TextFileEditorModel[] {
		if (Array.isArray(arg1)) {
			let models: TextFileEditorModel[] = [];
			(<URI[]>arg1).forEach((resource) => {
				models.push(...this.getFileModels(resource));
			});

			return models;
		}

		return CACHE.getAll(<URI>arg1);
	}

	private getDirtyFileModels(resources?: URI[]): TextFileEditorModel[];
	private getDirtyFileModels(resource?: URI): TextFileEditorModel[];
	private getDirtyFileModels(arg1?: any): TextFileEditorModel[] {
		return this.getFileModels(arg1).filter((model) => model.isDirty());
	}

	public abstract saveAs(resource: URI, targetResource?: URI): TPromise<URI>;

	public confirmSave(resources?: URI[]): ConfirmResult {
		throw new Error('Unsupported');
	}

	public revert(resource: URI, force?: boolean): TPromise<boolean> {
		return this.revertAll([resource], force).then((result) => result.results.length === 1 && result.results[0].success);
	}

	public revertAll(resources?: URI[], force?: boolean): TPromise<ITextFileOperationResult> {
		let fileModels = force ? this.getFileModels(resources) : this.getDirtyFileModels(resources);

		let mapResourceToResult: { [resource: string]: IResult } = Object.create(null);
		fileModels.forEach((m) => {
			mapResourceToResult[m.getResource().toString()] = {
				source: m.getResource()
			};
		});

		return TPromise.join(fileModels.map((model) => {
			return model.revert().then(() => {
				if (!model.isDirty()) {
					mapResourceToResult[model.getResource().toString()].success = true;
				}
			}, (error) => {

				// FileNotFound means the file got deleted meanwhile, so dispose
				if ((<IFileOperationResult>error).fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {

					// Inputs
					let clients = FileEditorInput.getAll(model.getResource());
					clients.forEach(input => input.dispose());

					// Model
					CACHE.dispose(model.getResource());

					// store as successful revert
					mapResourceToResult[model.getResource().toString()].success = true;
				}

				// Otherwise bubble up the error
				else {
					return TPromise.wrapError(error);
				}
			});
		})).then((r) => {
			return {
				results: Object.keys(mapResourceToResult).map((k) => mapResourceToResult[k])
			};
		});
	}

	public getAutoSaveMode(): AutoSaveMode {
		if (this.configuredAutoSaveOnFocusChange) {
			return AutoSaveMode.ON_FOCUS_CHANGE;
		}

		if (this.configuredAutoSaveOnWindowChange) {
			return AutoSaveMode.ON_WINDOW_CHANGE;
		}

		if (this.configuredAutoSaveDelay && this.configuredAutoSaveDelay > 0) {
			return this.configuredAutoSaveDelay <= 1000 ? AutoSaveMode.AFTER_SHORT_DELAY : AutoSaveMode.AFTER_LONG_DELAY;
		}

		return AutoSaveMode.OFF;
	}

	public getAutoSaveConfiguration(): IAutoSaveConfiguration {
		return {
			autoSaveDelay: this.configuredAutoSaveDelay && this.configuredAutoSaveDelay > 0 ? this.configuredAutoSaveDelay : void 0,
			autoSaveFocusChange: this.configuredAutoSaveOnFocusChange,
			autoSaveApplicationChange: this.configuredAutoSaveOnWindowChange
		};
	}

	public dispose(): void {
		this.listenerToUnbind = dispose(this.listenerToUnbind);

		// Clear all caches
		CACHE.clear();
	}
}