/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle';
import { autorunWithStore, observableFromEvent } from '../../../../base/common/observable';
import { IDiffEditor } from '../../../../editor/browser/editorBrowser';
import { registerDiffEditorContribution } from '../../../../editor/browser/editorExtensions';
import { EmbeddedDiffEditorWidget } from '../../../../editor/browser/widget/diffEditor/embeddedDiffEditorWidget';
import { IDiffEditorContribution } from '../../../../editor/common/editorCommon';
import { ITextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfiguration';
import { localize } from '../../../../nls';
import { AccessibleViewRegistry } from '../../../../platform/accessibility/browser/accessibleViewRegistry';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification';
import { Registry } from '../../../../platform/registry/common/platform';
import { FloatingEditorClickWidget } from '../../../browser/codeeditor';
import { Extensions, IConfigurationMigrationRegistry } from '../../../common/configuration';
import { DiffEditorAccessibilityHelp } from './diffEditorAccessibilityHelp';

class DiffEditorHelperContribution extends Disposable implements IDiffEditorContribution {
	public static readonly ID = 'editor.contrib.diffEditorHelper';

	constructor(
		private readonly _diffEditor: IDiffEditor,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ITextResourceConfigurationService private readonly _textResourceConfigurationService: ITextResourceConfigurationService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		super();

		const isEmbeddedDiffEditor = this._diffEditor instanceof EmbeddedDiffEditorWidget;

		if (!isEmbeddedDiffEditor) {
			const computationResult = observableFromEvent(this, e => this._diffEditor.onDidUpdateDiff(e), () => /** @description diffEditor.diffComputationResult */ this._diffEditor.getDiffComputationResult());
			const onlyWhiteSpaceChange = computationResult.map(r => r && !r.identical && r.changes2.length === 0);

			this._register(autorunWithStore((reader, store) => {
				/** @description update state */
				if (onlyWhiteSpaceChange.read(reader)) {
					const helperWidget = store.add(this._instantiationService.createInstance(
						FloatingEditorClickWidget,
						this._diffEditor.getModifiedEditor(),
						localize('hintWhitespace', "Show Whitespace Differences"),
						null
					));
					store.add(helperWidget.onClick(() => {
						this._textResourceConfigurationService.updateValue(this._diffEditor.getModel()!.modified.uri, 'diffEditor.ignoreTrimWhitespace', false);
					}));
					helperWidget.render();
				}
			}));

			this._register(this._diffEditor.onDidUpdateDiff(() => {
				const diffComputationResult = this._diffEditor.getDiffComputationResult();

				if (diffComputationResult && diffComputationResult.quitEarly) {
					this._notificationService.prompt(
						Severity.Warning,
						localize('hintTimeout', "The diff algorithm was stopped early (after {0} ms.)", this._diffEditor.maxComputationTime),
						[{
							label: localize('removeTimeout', "Remove Limit"),
							run: () => {
								this._textResourceConfigurationService.updateValue(this._diffEditor.getModel()!.modified.uri, 'diffEditor.maxComputationTime', 0);
							}
						}],
						{}
					);
				}
			}));
		}
	}
}

registerDiffEditorContribution(DiffEditorHelperContribution.ID, DiffEditorHelperContribution);

Registry.as<IConfigurationMigrationRegistry>(Extensions.ConfigurationMigration)
	.registerConfigurationMigrations([{
		key: 'diffEditor.experimental.collapseUnchangedRegions',
		migrateFn: (value, accessor) => {
			return [
				['diffEditor.hideUnchangedRegions.enabled', { value }],
				['diffEditor.experimental.collapseUnchangedRegions', { value: undefined }]
			];
		}
	}]);
AccessibleViewRegistry.register(new DiffEditorAccessibilityHelp());
