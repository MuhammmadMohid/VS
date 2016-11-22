/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import Severity from 'vs/base/common/severity';
import { TPromise } from 'vs/base/common/winjs.base';
import { TerminateResponse } from 'vs/base/common/processes';
import { IEventEmitter } from 'vs/base/common/eventEmitter';

import { ProblemMatcher } from 'vs/platform/markers/common/problemMatcher';
import * as nls from 'vs/nls';

export type ITaskIcon = string | { light: string; dark: string; };

export interface ITaskCommand {
	id: string;
	title: string;
	category?: string;
	icon?: ITaskIcon;
}

export function checkValidCommand(command: ITaskCommand): TaskError {
	if (!command) {
		return new TaskError(Severity.Error, nls.localize('nonempty', "expected non-empty value."), TaskErrors.ConfigValidationError);
	}
	if (typeof command.id !== 'string') {
		return new TaskError(Severity.Error, nls.localize('requirestring', "property `{0}` is mandatory and must be of type `string`", 'id'), TaskErrors.ConfigValidationError);
	}
	if (typeof command.title !== 'string') {
		return new TaskError(Severity.Error, nls.localize('requirestring', "property `{0}` is mandatory and must be of type `string`", 'title'), TaskErrors.ConfigValidationError);
	}
	if (command.category && typeof command.category !== 'string') {
		return new TaskError(Severity.Error, nls.localize('optstring', "property `{0}` can be omitted or must be of type `string`", 'category'), TaskErrors.ConfigValidationError);
	}
	return checkIconValid(command.icon);
}

function checkIconValid(icon: ITaskIcon): TaskError {
	if (typeof icon === 'undefined') {
		return;
	}
	if (typeof icon === 'string') {
		return;
	} else if (typeof icon.dark === 'string' && typeof icon.light === 'string') {
		return;
	}
	return new TaskError(Severity.Error, nls.localize('opticon', "property `icon` can be omitted or must be either a string or a literal like `{dark, light}`"), TaskErrors.ConfigValidationError);
}

export enum TaskErrors {
	NotConfigured,
	RunningTask,
	NoBuildTask,
	NoTestTask,
	ConfigValidationError,
	TaskNotFound,
	NoValidTaskRunner,
	UnknownError
}

export class TaskError {
	public severity: Severity;
	public message: string;
	public code: TaskErrors;

	constructor(severity: Severity, message: string, code: TaskErrors) {
		this.severity = severity;
		this.message = message;
		this.code = code;
	}
}

export interface TelemetryEvent {
	// How the task got trigger. Is either shortcut or command
	trigger: string;

	// The command triggered
	command: string;

	// Whether the task ran successful
	success: boolean;
}

export namespace Triggers {
	export let shortcut: string = 'shortcut';
	export let command: string = 'command';
}

export enum ShowOutput {
	Always,
	Silent,
	Never
}

export namespace ShowOutput {
	export function fromString(value: string): ShowOutput {
		value = value.toLowerCase();
		if (value === 'always') {
			return ShowOutput.Always;
		} else if (value === 'silent') {
			return ShowOutput.Silent;
		} else if (value === 'never') {
			return ShowOutput.Never;
		} else {
			return undefined;
		}
	}
}

/**
 * A task description
 */
export interface TaskDescription {

	/**
	 * The task's internal id
	 */
	id: string;

	/**
	 * The task's name
	 */
	name: string;

	/**
	 * Suppresses the task name when calling the task using the task runner.
	 */
	suppressTaskName?: boolean;

	/**
	 * Additional arguments passed to the command when this target is
	 * invoked.
	 */
	args?: string[];

	/**
	 * Whether the task is running in watching mode or not.
	 */
	isWatching?: boolean;

	/**
	 * Whether the task should prompt on close for confirmation if running.
	 */
	promptOnClose?: boolean;

	/**
	 * Controls whether the output of the running tasks is shown or not. Default
	 * value is "always".
	 */
	showOutput: ShowOutput;

	/**
	 * Controls whether the executed command is printed to the output windows as well.
	 */
	echoCommand?: boolean;

	/**
	 * The problem watchers to use for this task
	 */
	problemMatchers?:ProblemMatcher[];

	/**
	 * Command binding for task
	 */
	commandBinding?: ITaskCommand;
}

export interface CommandOptions {
	/**
	 * The current working directory of the executed program or shell.
	 * If omitted VSCode's current workspace root is used.
	 */
	cwd?: string;

	/**
	 * The environment of the executed program or shell. If omitted
	 * the parent process' environment is used.
	 */
	env?: { [key:string]: string; };
}


/**
 * Describs the settings of a task runner
 */
export interface BaseTaskRunnerConfiguration {

	/**
	 * The command to execute
	 */
	command?:string;

	/**
	 * Whether the task is a shell command or not
	 */
	isShellCommand?:boolean;

	/**
	 * Additional command options
	 */
	options?: CommandOptions;

	/**
	 * General args
	 */
	args?:string[];

	/**
	 * The configured tasks
	 */
	tasks?: { [id:string]: TaskDescription; };
}

/**
 * Describs the settings of a task runner
 */
export interface TaskRunnerConfiguration extends BaseTaskRunnerConfiguration {

	/**
	 * The command to execute. Not optional.
	 */
	command:string;
}

export interface ITaskSummary {
	/**
	 * Exit code of the process.
	 */
	exitCode?: number;
}

export interface ITaskRunResult {
	restartOnFileChanges?: string;
	promise: TPromise<ITaskSummary>;
}

export namespace TaskSystemEvents {
	export let Active: string = 'active';
	export let Inactive: string = 'inactive';
}

export enum TaskType {
	SingleRun,
	Watching
}

export interface TaskEvent {
	taskId?: string;
	taskName?: string;
	type?: TaskType;
}

export interface ITaskSystem extends IEventEmitter {
	build(): ITaskRunResult;
	rebuild(): ITaskRunResult;
	clean(): ITaskRunResult;
	runTest(): ITaskRunResult;
	run(taskIdentifier: string): ITaskRunResult;
	isActive(): TPromise<boolean>;
	isActiveSync(): boolean;
	canAutoTerminate(): boolean;
	terminate(): TPromise<TerminateResponse>;
	tasks(): TPromise<TaskDescription[]>;
}

/**
 * Build configuration settings shared between program and
 * service build systems.
 */
export interface TaskConfiguration {
	/**
	 * The build system to use. If omitted program is used.
	 */
	buildSystem?:string;
}