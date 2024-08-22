/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser';
import { EditorAction, registerEditorAction, ServicesAccessor } from '../../../../editor/browser/editorExtensions';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys';
import * as nls from '../../../../nls';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry';
import { ICommandService } from '../../../../platform/commands/common/commands';
import { INotificationService } from '../../../../platform/notification/common/notification';
import { VIEWLET_ID, IExtensionsViewPaneContainer } from '../../extensions/common/extensions';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite';
import { ViewContainerLocation } from '../../../common/views';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures';

async function showExtensionQuery(paneCompositeService: IPaneCompositePartService, query: string) {
	const viewlet = await paneCompositeService.openPaneComposite(VIEWLET_ID, ViewContainerLocation.Sidebar, true);
	if (viewlet) {
		(viewlet?.getViewPaneContainer() as IExtensionsViewPaneContainer).search(query);
	}
}

registerEditorAction(class FormatDocumentMultipleAction extends EditorAction {

	constructor() {
		super({
			id: 'editor.action.formatDocument.none',
			label: nls.localize('formatDocument.label.multiple', "Format Document"),
			alias: 'Format Document',
			precondition: ContextKeyExpr.and(EditorContextKeys.writable, EditorContextKeys.hasDocumentFormattingProvider.toNegated()),
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyMod.Shift | KeyMod.Alt | KeyCode.KeyF,
				linux: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyI },
				weight: KeybindingWeight.EditorContrib,
			}
		});
	}

	async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		if (!editor.hasModel()) {
			return;
		}

		const commandService = accessor.get(ICommandService);
		const paneCompositeService = accessor.get(IPaneCompositePartService);
		const notificationService = accessor.get(INotificationService);
		const dialogService = accessor.get(IDialogService);
		const languageFeaturesService = accessor.get(ILanguageFeaturesService);

		const model = editor.getModel();
		const formatterCount = languageFeaturesService.documentFormattingEditProvider.all(model).length;

		if (formatterCount > 1) {
			return commandService.executeCommand('editor.action.formatDocument.multiple');
		} else if (formatterCount === 1) {
			return commandService.executeCommand('editor.action.formatDocument');
		} else if (model.isTooLargeForSyncing()) {
			notificationService.warn(nls.localize('too.large', "This file cannot be formatted because it is too large"));
		} else {
			const langName = model.getLanguageId();
			const message = nls.localize('no.provider', "There is no formatter for '{0}' files installed.", langName);
			const { confirmed } = await dialogService.confirm({
				message,
				primaryButton: nls.localize({ key: 'install.formatter', comment: ['&& denotes a mnemonic'] }, "&&Install Formatter...")
			});
			if (confirmed) {
				showExtensionQuery(paneCompositeService, `category:formatters ${langName}`);
			}
		}
	}
});
