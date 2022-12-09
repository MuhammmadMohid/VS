/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This module contains utility functions related to the environment, cwd and paths.
 */

import * as path from 'vs/base/common/path';
import { URI as Uri } from 'vs/base/common/uri';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { sanitizeProcessEnvironment } from 'vs/base/common/processes';
import { ILogService } from 'vs/platform/log/common/log';
import { IShellLaunchConfig, ITerminalEnvironment, TerminalSettingId, TerminalSettingPrefix } from 'vs/platform/terminal/common/terminal';
import { IProcessEnvironment, isWindows, locale, platform, Platform } from 'vs/base/common/platform';
import { sanitizeCwd } from 'vs/platform/terminal/common/terminalEnvironment';

export function mergeEnvironments(parent: IProcessEnvironment, other: ITerminalEnvironment | undefined): void {
	if (!other) {
		return;
	}

	// On Windows apply the new values ignoring case, while still retaining
	// the case of the original key.
	if (isWindows) {
		for (const configKey in other) {
			let actualKey = configKey;
			for (const envKey in parent) {
				if (configKey.toLowerCase() === envKey.toLowerCase()) {
					actualKey = envKey;
					break;
				}
			}
			const value = other[configKey];
			if (value !== undefined) {
				_mergeEnvironmentValue(parent, actualKey, value);
			}
		}
	} else {
		Object.keys(other).forEach((key) => {
			const value = other[key];
			if (value !== undefined) {
				_mergeEnvironmentValue(parent, key, value);
			}
		});
	}
}

function _mergeEnvironmentValue(env: ITerminalEnvironment, key: string, value: string | null): void {
	if (typeof value === 'string') {
		env[key] = value;
	} else {
		delete env[key];
	}
}

export function addTerminalEnvironmentKeys(env: IProcessEnvironment, version: string | undefined, locale: string | undefined, detectLocale: 'auto' | 'off' | 'on'): void {
	env['TERM_PROGRAM'] = 'vscode';
	if (version) {
		env['TERM_PROGRAM_VERSION'] = version;
	}
	if (shouldSetLangEnvVariable(env, detectLocale)) {
		env['LANG'] = getLangEnvVariable(locale);
	}
	env['COLORTERM'] = 'truecolor';
}

function mergeNonNullKeys(env: IProcessEnvironment, other: ITerminalEnvironment | undefined) {
	if (!other) {
		return;
	}
	for (const key of Object.keys(other)) {
		const value = other[key];
		if (value) {
			env[key] = value;
		}
	}
}

async function resolveConfigurationVariables(variableResolver: VariableResolver, env: ITerminalEnvironment): Promise<ITerminalEnvironment> {
	await Promise.all(Object.entries(env).map(async ([key, value]) => {
		if (typeof value === 'string') {
			try {
				env[key] = await variableResolver(value);
			} catch (e) {
				env[key] = value;
			}
		}
	}));

	return env;
}

export function shouldSetLangEnvVariable(env: IProcessEnvironment, detectLocale: 'auto' | 'off' | 'on'): boolean {
	if (detectLocale === 'on') {
		return true;
	}
	if (detectLocale === 'auto') {
		const lang = env['LANG'];
		return !lang || (lang.search(/\.UTF\-8$/) === -1 && lang.search(/\.utf8$/) === -1 && lang.search(/\.euc.+/) === -1);
	}
	return false; // 'off'
}

export function getLangEnvVariable(locale?: string): string {
	const parts = locale ? locale.split('-') : [];
	const n = parts.length;
	if (n === 0) {
		// Fallback to en_US if the locale is unknown
		return 'en_US.UTF-8';
	}
	if (n === 1) {
		// The local may only contain the language, not the variant, if this is the case guess the
		// variant such that it can be used as a valid $LANG variable. The language variant chosen
		// is the original and/or most prominent with help from
		// https://stackoverflow.com/a/2502675/1156119
		// The list of locales was generated by running `locale -a` on macOS
		const languageVariants: { [key: string]: string } = {
			af: 'ZA',
			am: 'ET',
			be: 'BY',
			bg: 'BG',
			ca: 'ES',
			cs: 'CZ',
			da: 'DK',
			// de: 'AT',
			// de: 'CH',
			de: 'DE',
			el: 'GR',
			// en: 'AU',
			// en: 'CA',
			// en: 'GB',
			// en: 'IE',
			// en: 'NZ',
			en: 'US',
			es: 'ES',
			et: 'EE',
			eu: 'ES',
			fi: 'FI',
			// fr: 'BE',
			// fr: 'CA',
			// fr: 'CH',
			fr: 'FR',
			he: 'IL',
			hr: 'HR',
			hu: 'HU',
			hy: 'AM',
			is: 'IS',
			// it: 'CH',
			it: 'IT',
			ja: 'JP',
			kk: 'KZ',
			ko: 'KR',
			lt: 'LT',
			// nl: 'BE',
			nl: 'NL',
			no: 'NO',
			pl: 'PL',
			pt: 'BR',
			// pt: 'PT',
			ro: 'RO',
			ru: 'RU',
			sk: 'SK',
			sl: 'SI',
			sr: 'YU',
			sv: 'SE',
			tr: 'TR',
			uk: 'UA',
			zh: 'CN',
		};
		if (parts[0] in languageVariants) {
			parts.push(languageVariants[parts[0]]);
		}
	} else {
		// Ensure the variant is uppercase to be a valid $LANG
		parts[1] = parts[1].toUpperCase();
	}
	return parts.join('_') + '.UTF-8';
}

export async function getCwd(
	shell: IShellLaunchConfig,
	userHome: string | undefined,
	variableResolver: VariableResolver | undefined,
	root: Uri | undefined,
	customCwd: string | undefined,
	logService?: ILogService
): Promise<string> {
	if (shell.cwd) {
		const unresolved = (typeof shell.cwd === 'object') ? shell.cwd.fsPath : shell.cwd;
		const resolved = await _resolveCwd(unresolved, variableResolver);
		return sanitizeCwd(resolved || unresolved);
	}

	let cwd: string | undefined;

	if (!shell.ignoreConfigurationCwd && customCwd) {
		if (variableResolver) {
			customCwd = await _resolveCwd(customCwd, variableResolver, logService);
		}
		if (customCwd) {
			if (path.isAbsolute(customCwd)) {
				cwd = customCwd;
			} else if (root) {
				cwd = path.join(root.fsPath, customCwd);
			}
		}
	}

	// If there was no custom cwd or it was relative with no workspace
	if (!cwd) {
		cwd = root ? root.fsPath : userHome || '';
	}

	return sanitizeCwd(cwd);
}

async function _resolveCwd(cwd: string, variableResolver: VariableResolver | undefined, logService?: ILogService): Promise<string | undefined> {
	if (variableResolver) {
		try {
			return await variableResolver(cwd);
		} catch (e) {
			logService?.error('Could not resolve terminal cwd', e);
			return undefined;
		}
	}
	return cwd;
}

export type TerminalShellSetting = (
	TerminalSettingId.AutomationShellWindows
	| TerminalSettingId.AutomationShellMacOs
	| TerminalSettingId.AutomationShellLinux
	| TerminalSettingId.ShellWindows
	| TerminalSettingId.ShellMacOs
	| TerminalSettingId.ShellLinux
);

export type TerminalShellArgsSetting = (
	TerminalSettingId.ShellArgsWindows
	| TerminalSettingId.ShellArgsMacOs
	| TerminalSettingId.ShellArgsLinux
);

export type VariableResolver = (str: string) => Promise<string>;

export function createVariableResolver(lastActiveWorkspace: IWorkspaceFolder | undefined, env: IProcessEnvironment, configurationResolverService: IConfigurationResolverService | undefined): VariableResolver | undefined {
	if (!configurationResolverService) {
		return undefined;
	}
	return (str) => configurationResolverService.resolveWithEnvironment(env, lastActiveWorkspace, str);
}

/**
 * @deprecated Use ITerminalProfileResolverService
 */
export async function getDefaultShell(
	fetchSetting: (key: TerminalShellSetting) => string | undefined,
	defaultShell: string,
	isWoW64: boolean,
	windir: string | undefined,
	variableResolver: VariableResolver | undefined,
	logService: ILogService,
	useAutomationShell: boolean,
	platformOverride: Platform = platform
): Promise<string> {
	let maybeExecutable: string | undefined;
	if (useAutomationShell) {
		// If automationShell is specified, this should override the normal setting
		maybeExecutable = getShellSetting(fetchSetting, 'automationShell', platformOverride) as string | undefined;
	}
	if (!maybeExecutable) {
		maybeExecutable = getShellSetting(fetchSetting, 'shell', platformOverride) as string | undefined;
	}
	let executable: string = maybeExecutable || defaultShell;

	// Change Sysnative to System32 if the OS is Windows but NOT WoW64. It's
	// safe to assume that this was used by accident as Sysnative does not
	// exist and will break the terminal in non-WoW64 environments.
	if ((platformOverride === Platform.Windows) && !isWoW64 && windir) {
		const sysnativePath = path.join(windir, 'Sysnative').replace(/\//g, '\\').toLowerCase();
		if (executable && executable.toLowerCase().indexOf(sysnativePath) === 0) {
			executable = path.join(windir, 'System32', executable.substr(sysnativePath.length + 1));
		}
	}

	// Convert / to \ on Windows for convenience
	if (executable && platformOverride === Platform.Windows) {
		executable = executable.replace(/\//g, '\\');
	}

	if (variableResolver) {
		try {
			executable = await variableResolver(executable);
		} catch (e) {
			logService.error(`Could not resolve shell`, e);
		}
	}

	return executable;
}

/**
 * @deprecated Use ITerminalProfileResolverService
 */
export async function getDefaultShellArgs(
	fetchSetting: (key: TerminalShellSetting | TerminalShellArgsSetting) => string | string[] | undefined,
	useAutomationShell: boolean,
	variableResolver: VariableResolver | undefined,
	logService: ILogService,
	platformOverride: Platform = platform,
): Promise<string | string[]> {
	if (useAutomationShell) {
		if (!!getShellSetting(fetchSetting, 'automationShell', platformOverride)) {
			return [];
		}
	}

	const platformKey = platformOverride === Platform.Windows ? 'windows' : platformOverride === Platform.Mac ? 'osx' : 'linux';
	let args = fetchSetting(<TerminalShellArgsSetting>`${TerminalSettingPrefix.ShellArgs}${platformKey}`);
	if (!args) {
		return [];
	}
	if (typeof args === 'string' && platformOverride === Platform.Windows) {
		return variableResolver ? await variableResolver(args) : args;
	}
	if (variableResolver) {
		const resolvedArgs: string[] = [];
		for (const arg of args) {
			try {
				resolvedArgs.push(await variableResolver(arg));
			} catch (e) {
				logService.error(`Could not resolve ${TerminalSettingPrefix.ShellArgs}${platformKey}`, e);
				resolvedArgs.push(arg);
			}
		}
		args = resolvedArgs;
	}
	return args;
}

function getShellSetting(
	fetchSetting: (key: TerminalShellSetting) => string | string[] | undefined,
	type: 'automationShell' | 'shell',
	platformOverride: Platform = platform,
): string | string[] | undefined {
	const platformKey = platformOverride === Platform.Windows ? 'windows' : platformOverride === Platform.Mac ? 'osx' : 'linux';
	return fetchSetting(<TerminalShellSetting>`terminal.integrated.${type}.${platformKey}`);
}

export async function createTerminalEnvironment(
	shellLaunchConfig: IShellLaunchConfig,
	envFromConfig: ITerminalEnvironment | undefined,
	variableResolver: VariableResolver | undefined,
	version: string | undefined,
	detectLocale: 'auto' | 'off' | 'on',
	baseEnv: IProcessEnvironment
): Promise<IProcessEnvironment> {
	// Create a terminal environment based on settings, launch config and permissions
	const env: IProcessEnvironment = {};
	if (shellLaunchConfig.strictEnv) {
		// strictEnv is true, only use the requested env (ignoring null entries)
		mergeNonNullKeys(env, shellLaunchConfig.env);
	} else {
		// Merge process env with the env from config and from shellLaunchConfig
		mergeNonNullKeys(env, baseEnv);

		const allowedEnvFromConfig = { ...envFromConfig };

		// Resolve env vars from config and shell
		if (variableResolver) {
			if (allowedEnvFromConfig) {
				await resolveConfigurationVariables(variableResolver, allowedEnvFromConfig);
			}
			if (shellLaunchConfig.env) {
				await resolveConfigurationVariables(variableResolver, shellLaunchConfig.env);
			}
		}

		// Sanitize the environment, removing any undesirable VS Code and Electron environment
		// variables
		sanitizeProcessEnvironment(env, 'VSCODE_IPC_HOOK_CLI');

		// Merge config (settings) and ShellLaunchConfig environments
		mergeEnvironments(env, allowedEnvFromConfig);
		mergeEnvironments(env, shellLaunchConfig.env);

		// Adding other env keys necessary to create the process
		addTerminalEnvironmentKeys(env, version, locale, detectLocale);
	}
	return env;
}
