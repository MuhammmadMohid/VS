/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService';
import { IDialogHandler, IDialogResult, IDialogService } from '../../../../platform/dialogs/common/dialogs';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService';
import { ILogService } from '../../../../platform/log/common/log';
import { IProductService } from '../../../../platform/product/common/productService';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions';
import { IDialogsModel, IDialogViewItem } from '../../../common/dialogs';
import { BrowserDialogHandler } from './dialogHandler';
import { DialogService } from '../../../services/dialogs/common/dialogService';
import { Disposable } from '../../../../base/common/lifecycle';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation';
import { Lazy } from '../../../../base/common/lazy';

export class DialogHandlerContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.dialogHandler';

	private readonly model: IDialogsModel;
	private readonly impl: Lazy<IDialogHandler>;

	private currentDialog: IDialogViewItem | undefined;

	constructor(
		@IDialogService private dialogService: IDialogService,
		@ILogService logService: ILogService,
		@ILayoutService layoutService: ILayoutService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IProductService productService: IProductService,
		@IClipboardService clipboardService: IClipboardService
	) {
		super();

		this.impl = new Lazy(() => new BrowserDialogHandler(logService, layoutService, keybindingService, instantiationService, productService, clipboardService));

		this.model = (this.dialogService as DialogService).model;

		this._register(this.model.onWillShowDialog(() => {
			if (!this.currentDialog) {
				this.processDialogs();
			}
		}));

		this.processDialogs();
	}

	private async processDialogs(): Promise<void> {
		while (this.model.dialogs.length) {
			this.currentDialog = this.model.dialogs[0];

			let result: IDialogResult | Error | undefined = undefined;
			try {
				if (this.currentDialog.args.confirmArgs) {
					const args = this.currentDialog.args.confirmArgs;
					result = await this.impl.value.confirm(args.confirmation);
				} else if (this.currentDialog.args.inputArgs) {
					const args = this.currentDialog.args.inputArgs;
					result = await this.impl.value.input(args.input);
				} else if (this.currentDialog.args.promptArgs) {
					const args = this.currentDialog.args.promptArgs;
					result = await this.impl.value.prompt(args.prompt);
				} else {
					await this.impl.value.about();
				}
			} catch (error) {
				result = error;
			}

			this.currentDialog.close(result);
			this.currentDialog = undefined;
		}
	}
}

registerWorkbenchContribution2(
	DialogHandlerContribution.ID,
	DialogHandlerContribution,
	WorkbenchPhase.BlockStartup // Block to allow for dialogs to show before restore finished
);
