/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes';
import { ServicesAccessor } from '../../../../../editor/browser/editorExtensions';
import { localize2 } from '../../../../../nls';
import { AccessibilitySignal, IAccessibilitySignalService } from '../../../../../platform/accessibilitySignal/browser/accessibilitySignalService';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry';
import { ActiveEditorContext } from '../../../../common/contextkeys';
import { CHAT_CATEGORY, isChatViewTitleActionContext } from './chatActions';
import { clearChatEditor } from './chatClear';
import { CHAT_VIEW_ID, IChatWidgetService } from '../chat';
import { ChatEditorInput } from '../chatEditorInput';
import { ChatViewPane } from '../chatViewPane';
import { CONTEXT_IN_CHAT_SESSION, CONTEXT_CHAT_ENABLED } from '../../common/chatContextKeys';
import { IViewsService } from '../../../../services/views/common/viewsService';

export const ACTION_ID_NEW_CHAT = `workbench.action.chat.newChat`;

export function registerNewChatActions() {
	registerAction2(class NewChatEditorAction extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.chatEditor.newChat',
				title: localize2('chat.newChat.label', "New Chat"),
				icon: Codicon.plus,
				f1: false,
				precondition: CONTEXT_CHAT_ENABLED,
				menu: [{
					id: MenuId.EditorTitle,
					group: 'navigation',
					order: 0,
					when: ActiveEditorContext.isEqualTo(ChatEditorInput.EditorID),
				}]
			});
		}
		async run(accessor: ServicesAccessor, ...args: any[]) {
			announceChatCleared(accessor.get(IAccessibilitySignalService));
			await clearChatEditor(accessor);
		}
	});

	registerAction2(class GlobalClearChatAction extends Action2 {
		constructor() {
			super({
				id: ACTION_ID_NEW_CHAT,
				title: localize2('chat.newChat.label', "New Chat"),
				category: CHAT_CATEGORY,
				icon: Codicon.plus,
				precondition: CONTEXT_CHAT_ENABLED,
				f1: true,
				keybinding: {
					weight: KeybindingWeight.WorkbenchContrib,
					primary: KeyMod.CtrlCmd | KeyCode.KeyL,
					mac: {
						primary: KeyMod.WinCtrl | KeyCode.KeyL
					},
					when: CONTEXT_IN_CHAT_SESSION
				},
				menu: [{
					id: MenuId.ChatContext,
					group: 'z_clear'
				},
				{
					id: MenuId.ViewTitle,
					when: ContextKeyExpr.equals('view', CHAT_VIEW_ID),
					group: 'navigation',
					order: -1
				}]
			});
		}

		async run(accessor: ServicesAccessor, ...args: any[]) {
			const context = args[0];
			const accessibilitySignalService = accessor.get(IAccessibilitySignalService);
			if (isChatViewTitleActionContext(context)) {
				// Is running in the Chat view title
				announceChatCleared(accessibilitySignalService);
				context.chatView.widget.clear();
				context.chatView.widget.focusInput();
			} else {
				// Is running from f1 or keybinding
				const widgetService = accessor.get(IChatWidgetService);
				const viewsService = accessor.get(IViewsService);

				let widget = widgetService.lastFocusedWidget;
				if (!widget) {
					const chatView = await viewsService.openView(CHAT_VIEW_ID) as ChatViewPane;
					widget = chatView.widget;
				}

				announceChatCleared(accessibilitySignalService);
				widget.clear();
				widget.focusInput();
			}
		}
	});
}

function announceChatCleared(accessibilitySignalService: IAccessibilitySignalService): void {
	accessibilitySignalService.playSignal(AccessibilitySignal.clear);
}
