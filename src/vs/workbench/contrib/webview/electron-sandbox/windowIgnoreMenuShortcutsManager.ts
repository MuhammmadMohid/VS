/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isMacintosh } from '../../../../base/common/platform';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService';
import { INativeHostService } from '../../../../platform/native/common/native';
import { IWebviewManagerService } from '../../../../platform/webview/common/webviewManagerService';
import { hasNativeTitlebar } from '../../../../platform/window/common/window';

export class WindowIgnoreMenuShortcutsManager {

	private readonly _isUsingNativeTitleBars: boolean;

	private readonly _webviewMainService: IWebviewManagerService;

	constructor(
		configurationService: IConfigurationService,
		mainProcessService: IMainProcessService,
		private readonly _nativeHostService: INativeHostService
	) {
		this._isUsingNativeTitleBars = hasNativeTitlebar(configurationService);

		this._webviewMainService = ProxyChannel.toService<IWebviewManagerService>(mainProcessService.getChannel('webview'));
	}

	public didFocus(): void {
		this.setIgnoreMenuShortcuts(true);
	}

	public didBlur(): void {
		this.setIgnoreMenuShortcuts(false);
	}

	private get _shouldToggleMenuShortcutsEnablement() {
		return isMacintosh || this._isUsingNativeTitleBars;
	}

	protected setIgnoreMenuShortcuts(value: boolean) {
		if (this._shouldToggleMenuShortcutsEnablement) {
			this._webviewMainService.setIgnoreMenuShortcuts({ windowId: this._nativeHostService.windowId }, value);
		}
	}
}
