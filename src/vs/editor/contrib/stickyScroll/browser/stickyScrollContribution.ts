/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorContributionInstantiation, registerEditorContribution } from '../../../browser/editorExtensions';
import { ToggleStickyScroll, FocusStickyScroll, SelectEditor, SelectPreviousStickyScrollLine, SelectNextStickyScrollLine, GoToStickyScrollLine } from './stickyScrollActions';
import { StickyScrollController } from './stickyScrollController';
import { registerAction2 } from '../../../../platform/actions/common/actions';

registerEditorContribution(StickyScrollController.ID, StickyScrollController, EditorContributionInstantiation.AfterFirstRender);
registerAction2(ToggleStickyScroll);
registerAction2(FocusStickyScroll);
registerAction2(SelectPreviousStickyScrollLine);
registerAction2(SelectNextStickyScrollLine);
registerAction2(GoToStickyScrollLine);
registerAction2(SelectEditor);
