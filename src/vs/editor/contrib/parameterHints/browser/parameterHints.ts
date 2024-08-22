/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes';
import { Lazy } from '../../../../base/common/lazy';
import { Disposable } from '../../../../base/common/lifecycle';
import { ICodeEditor } from '../../../browser/editorBrowser';
import { EditorAction, EditorCommand, EditorContributionInstantiation, registerEditorAction, registerEditorCommand, registerEditorContribution, ServicesAccessor } from '../../../browser/editorExtensions';
import { IEditorContribution } from '../../../common/editorCommon';
import { EditorContextKeys } from '../../../common/editorContextKeys';
import * as languages from '../../../common/languages';
import { ILanguageFeaturesService } from '../../../common/services/languageFeatures';
import { ParameterHintsModel, TriggerContext } from './parameterHintsModel';
import { Context } from './provideSignatureHelp';
import * as nls from '../../../../nls';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry';
import { ParameterHintsWidget } from './parameterHintsWidget';

export class ParameterHintsController extends Disposable implements IEditorContribution {

	public static readonly ID = 'editor.controller.parameterHints';

	public static get(editor: ICodeEditor): ParameterHintsController | null {
		return editor.getContribution<ParameterHintsController>(ParameterHintsController.ID);
	}

	private readonly editor: ICodeEditor;
	private readonly model: ParameterHintsModel;
	private readonly widget: Lazy<ParameterHintsWidget>;

	constructor(
		editor: ICodeEditor,
		@IInstantiationService instantiationService: IInstantiationService,
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
	) {
		super();

		this.editor = editor;

		this.model = this._register(new ParameterHintsModel(editor, languageFeaturesService.signatureHelpProvider));

		this._register(this.model.onChangedHints(newParameterHints => {
			if (newParameterHints) {
				this.widget.value.show();
				this.widget.value.render(newParameterHints);
			} else {
				this.widget.rawValue?.hide();
			}
		}));

		this.widget = new Lazy(() => this._register(instantiationService.createInstance(ParameterHintsWidget, this.editor, this.model)));
	}

	cancel(): void {
		this.model.cancel();
	}

	previous(): void {
		this.widget.rawValue?.previous();
	}

	next(): void {
		this.widget.rawValue?.next();
	}

	trigger(context: TriggerContext): void {
		this.model.trigger(context, 0);
	}
}

export class TriggerParameterHintsAction extends EditorAction {

	constructor() {
		super({
			id: 'editor.action.triggerParameterHints',
			label: nls.localize('parameterHints.trigger.label', "Trigger Parameter Hints"),
			alias: 'Trigger Parameter Hints',
			precondition: EditorContextKeys.hasSignatureHelpProvider,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Space,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		const controller = ParameterHintsController.get(editor);
		controller?.trigger({
			triggerKind: languages.SignatureHelpTriggerKind.Invoke
		});
	}
}

registerEditorContribution(ParameterHintsController.ID, ParameterHintsController, EditorContributionInstantiation.BeforeFirstInteraction);
registerEditorAction(TriggerParameterHintsAction);

const weight = KeybindingWeight.EditorContrib + 75;

const ParameterHintsCommand = EditorCommand.bindToContribution<ParameterHintsController>(ParameterHintsController.get);

registerEditorCommand(new ParameterHintsCommand({
	id: 'closeParameterHints',
	precondition: Context.Visible,
	handler: x => x.cancel(),
	kbOpts: {
		weight: weight,
		kbExpr: EditorContextKeys.focus,
		primary: KeyCode.Escape,
		secondary: [KeyMod.Shift | KeyCode.Escape]
	}
}));

registerEditorCommand(new ParameterHintsCommand({
	id: 'showPrevParameterHint',
	precondition: ContextKeyExpr.and(Context.Visible, Context.MultipleSignatures),
	handler: x => x.previous(),
	kbOpts: {
		weight: weight,
		kbExpr: EditorContextKeys.focus,
		primary: KeyCode.UpArrow,
		secondary: [KeyMod.Alt | KeyCode.UpArrow],
		mac: { primary: KeyCode.UpArrow, secondary: [KeyMod.Alt | KeyCode.UpArrow, KeyMod.WinCtrl | KeyCode.KeyP] }
	}
}));

registerEditorCommand(new ParameterHintsCommand({
	id: 'showNextParameterHint',
	precondition: ContextKeyExpr.and(Context.Visible, Context.MultipleSignatures),
	handler: x => x.next(),
	kbOpts: {
		weight: weight,
		kbExpr: EditorContextKeys.focus,
		primary: KeyCode.DownArrow,
		secondary: [KeyMod.Alt | KeyCode.DownArrow],
		mac: { primary: KeyCode.DownArrow, secondary: [KeyMod.Alt | KeyCode.DownArrow, KeyMod.WinCtrl | KeyCode.KeyN] }
	}
}));
